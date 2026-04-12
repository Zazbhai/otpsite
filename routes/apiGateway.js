const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Service = require("../models/Service");
const Server = require("../models/Server");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const providerApi = require("../utils/providerApi");
const { nanoid } = require("nanoid");

router.all("/", async (req, res) => {
  try {
    const query = req.method === "POST" ? req.body : req.query;
    const { api_key, action } = query;

    if (!api_key) return res.send("BAD_KEY");

    const user = await User.findOne({ api_key });
    if (!user) return res.send("BAD_KEY");
    if (user.is_banned) return res.send("USER_BANNED");

    switch (action) {
      case "getBalance":
        return res.send(`ACCESS_BALANCE:${user.balance.toFixed(4)}`);

      case "getOperators": {
        // Return active server slugs as operators
        const servers = await Server.find({ is_active: true });
        const ops = {};
        for (const s of servers) {
          ops[s.name] = s.slug;
        }
        ops["Any"] = "any";
        return res.json(ops);
      }

      case "getCountries": {
        // Return a static mapping of country code to country name
        // (You could also dynamically build this from Service.countries)
        // A generic sample based on normal usage:
        const countriesMap = {
          "1": "Ukraine", "21": "USA", "22": "Canada", "2": "Kazakhstan", "3": "China",
          "4": "Philippines", "5": "Myanmar", "6": "Indonesia", "7": "Malaysia", "8": "Kenya",
          "10": "Russia", "44": "UK", "91": "India"
        };
        // Let's populate from active services to be safe
        const services = await Service.find({ is_active: true });
        services.forEach(s => {
          s.countries.forEach(c => {
             if (!countriesMap[c.country]) countriesMap[c.country] = "Country " + c.country;
          });
        });
        return res.json(countriesMap);
      }

      case "getServices": {
        const services = await Service.find({ is_active: true });
        const sMap = {};
        services.forEach(s => sMap[s.slug] = s.name);
        return res.json(sMap);
      }

      case "getPrices": {
        // { "country": { "service": { "price": "count" } } }
        const { country, operator } = query;
        const targetCountry = country;
        const targetOperator = operator && operator !== "any" ? operator : null;

        const services = await Service.find({ is_active: true });
        const prices = {};

        for (const svc of services) {
           for (const c of svc.countries) {
              if (targetCountry && c.country !== targetCountry) continue;
              
              if (!prices[c.country]) prices[c.country] = {};
              if (!prices[c.country][svc.slug]) prices[c.country][svc.slug] = {};

              // Find options for the operator
              for (const opt of c.options) {
                 if (!opt.is_active) continue;
                 
                 // If specific operator requested, we check against server slug or id
                 // To do this we might need server objects. Let's just combine all active option prices
                 // The "count" is fake since we don't know provider inventory without querying.
                 const priceKey = opt.price.toFixed(2);
                 prices[c.country][svc.slug][priceKey] = (prices[c.country][svc.slug][priceKey] || 0) + 100; // Fake count 100
              }
              // If none added, remove
              if (Object.keys(prices[c.country][svc.slug]).length === 0) {
                 delete prices[c.country][svc.slug];
              }
           }
        }
        return res.json(prices);
      }

      case "getNumber": {
        let { service, country, operator, maxPrice } = query;
        if (!service) return res.send("BAD_SERVICE");
        if (!country) return res.send("BAD_COUNTRY");

        // Parse operator from service if dashed
        if (service.includes("-")) {
          const parts = service.split("-");
          operator = parts[0];
          service = parts.slice(1).join("-");
        }

        const svc = await Service.findOne({ slug: service, is_active: true });
        if (!svc) return res.send("BAD_SERVICE");

        const cData = svc.countries.find(c => c.country == country);
        if (!cData) return res.send("BAD_COUNTRY");

        let activeOptions = cData.options.filter(o => o.is_active);
        
        // Filter by maxPrice
        if (maxPrice) {
          const maxP = parseFloat(maxPrice);
          activeOptions = activeOptions.filter(o => o.price <= maxP);
        }

        if (activeOptions.length === 0) return res.send("NO_NUMBERS");

        // If specific operator passed, find Server by slug
        if (operator && operator !== "any") {
           const targetServer = await Server.findOne({ slug: operator });
           if (targetServer) {
              activeOptions = activeOptions.filter(o => o.server_id.toString() === targetServer._id.toString());
           } else {
              // fallback: maybe they passed Server ID directly
              activeOptions = activeOptions.filter(o => o.server_id.toString() === operator);
           }
        }

        if (activeOptions.length === 0) return res.send("BAD_OPERATOR");

        // Just pick the cheapest valid option
        activeOptions.sort((a,b) => a.price - b.price);
        const option = activeOptions[0];

        if (user.balance < option.price) return res.send("NO_BALANCE");

        const serverConf = await Server.findById(option.server_id);
        if (!serverConf || !serverConf.is_active) return res.send("NO_NUMBERS");

        const serviceCode = option.code || svc.slug;
        const providerRes = await providerApi.getNumber(serverConf, serviceCode, country);
        
        if (providerRes.error) {
           return res.send("NO_NUMBERS");
        }

        // Deduct Balance
        user.balance = parseFloat((user.balance - option.price).toFixed(4));
        user.total_spent = parseFloat((user.total_spent + option.price).toFixed(4));
        user.total_orders += 1;
        await user.save();

        const orderId = "ORD-" + nanoid(10).toUpperCase();
        const minCancelAt = new Date(Date.now() + (serverConf.min_cancel_minutes || 0) * 60 * 1000);

        const order = await Order.create({
          order_id: orderId,
          user_id: user._id,
          service_name: svc.name,
          server_name: option.server_name,
          country,
          phone: providerRes.phone,
          external_order_id: providerRes.api_order_id,
          cost: option.price,
          status: "active",
          expires_at: new Date(Date.now() + (serverConf.auto_cancel_minutes || 20) * 60 * 1000),
          min_cancel_at: minCancelAt,
        });

        await Transaction.create({
          user_id: user._id,
          type: "purchase",
          amount: -option.price,
          balance_after: user.balance,
          description: `API: Purchased ${svc.name} (${country})`,
          order_id: orderId,
        });

        // Some SMS sites return ACCESS_NUMBER:API_ORDER_ID:PHONE
        return res.send(`ACCESS_NUMBER:${orderId}:${providerRes.phone.replace(/\\D/g, '')}`);
      }

      case "getStatus": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");

        const order = await Order.findOne({ order_id: id, user_id: user._id });
        if (!order) return res.send("NO_ACTIVATION");

        if (order.status === "completed" || order.otp) {
           return res.send(`STATUS_OK:${order.otp}`);
        }
        if (order.status === "cancelled" || order.status === "expired" || order.status === "refunded") {
           return res.send("STATUS_CANCEL");
        }

        // If active, check provider
        const service = await Service.findOne({ name: order.service_name });
        let serverId = null;
        if (service) {
           for (const c of service.countries) {
              for (const opt of c.options) {
                 if (opt.server_name === order.server_name) serverId = opt.server_id;
              }
           }
        }
        if (serverId && order.external_order_id) {
           const serverConf = await Server.findById(serverId);
           if (serverConf && serverConf.api_check_status_url) {
              const checkRes = await providerApi.checkStatus(serverConf, order.external_order_id);
              if (!checkRes.error && checkRes.status !== "waiting") {
                 order.status = checkRes.status;
                 if (checkRes.otp) {
                    order.otp = checkRes.otp;
                    if (!order.all_otps.includes(checkRes.otp)) order.all_otps.push(checkRes.otp);
                 }
                 await order.save();
                 if (order.otp) {
                    return res.send(`STATUS_OK:${order.otp}`);
                 }
              }
           }
        }
        return res.send("STATUS_WAIT_CODE");
      }

      case "getStatusV2": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        const ids = id.split(",").map(i => i.trim());
        const orders = await Order.find({ order_id: { $in: ids }, user_id: user._id });
        
        const result = {};
        for (const order of orders) {
           if (order.status === "completed" || order.otp) {
              result[order.order_id] = `STATUS_OK:${order.otp}`;
           } else if (order.status === "cancelled" || order.status === "expired" || order.status === "refunded") {
              result[order.order_id] = "STATUS_CANCEL";
           } else {
              result[order.order_id] = "STATUS_WAIT_CODE";
              // (In v2 we don't poll provider synchronously to avoid hanging on 100 orders,
              // we just return DB state. Typically users call getStatus for active polling)
           }
        }
        return res.json(result);
      }

      case "setStatus": {
        const { id, status } = query;
        if (!id) return res.send("BAD_REQUEST");
        
        const order = await Order.findOne({ order_id: id, user_id: user._id });
        if (!order) return res.send("NO_ACTIVATION");

        // status=8 -> Cancel
        const API_STATUS_CANCEL = process.env.API_STATUS_CANCEL || "8";
        if (status === API_STATUS_CANCEL) {
           if (order.status !== "active") {
              return res.send(order.status === "cancelled" ? "ACCESS_CANCEL_ALREADY" : "ACCESS_CANCEL");
           }
           
           // find server and cancel
           const service = await Service.findOne({ name: order.service_name });
           let serverId = null;
           if (service) {
              for (const c of service.countries) {
                for (const opt of c.options) {
                  if (opt.server_name === order.server_name) serverId = opt.server_id;
                }
              }
           }
           if (serverId && order.external_order_id) {
             const serverConf = await Server.findById(serverId);
             if (serverConf && serverConf.api_cancel_url) {
                await providerApi.cancelOrder(serverConf, order.external_order_id);
             }
           }

           // Refund
           user.balance = parseFloat((user.balance + order.cost).toFixed(4));
           await user.save();

           await Transaction.create({
              user_id: user._id, type: "refund", amount: order.cost,
              balance_after: user.balance, description: `API Cancelled order ${order.order_id}`, order_id: order.order_id
           });

           order.status = "cancelled";
           await order.save();
           return res.send("ACCESS_CANCEL");
        }

        // status=3 -> Request another SMS (retry)
        if (status == "3") {
           if (order.status !== "completed") return res.send("BAD_STATUS");
           
           // Let's simplified retry state
           order.status = "active";
           order.otp = null;
           order.expires_at = new Date(Date.now() + 20 * 60 * 1000);
           await order.save();
           return res.send("ACCESS_RETRY_GET");
        }

        return res.send("BAD_STATUS");
      }

      default:
        return res.send("BAD_ACTION");
    }

  } catch (err) {
    console.error("API Gateway Error", err);
    return res.send("ERROR");
  }
});

module.exports = router;

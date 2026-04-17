const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Service = require("../models/Service");
const Server = require("../models/Server");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const Country = require("../models/Country");
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
        const countries = await Country.find({ is_active: true }).sort({ name: 1 });
        const countriesMap = {};
        countries.forEach(c => {
          countriesMap[c.code] = c.name;
        });
        return res.json(countriesMap);
      }

      case "getServices": {
        const services = await Service.find({ is_active: true });
        const sMap = {};
        services.forEach(s => {
          // Use service_code as the primary key for the API
          sMap[s.service_code] = s.name;
        });
        return res.json(sMap);
      }

      case "getPrices": {
        const { country } = query;
        const services = await Service.find({ is_active: true });
        const prices = {};

        services.forEach(svc => {
          if (country && svc.country_code !== country) return;
          
          if (!prices[svc.country_code]) prices[svc.country_code] = {};
          if (!prices[svc.country_code][svc.service_code]) prices[svc.country_code][svc.service_code] = {};
          
          const priceKey = svc.price.toFixed(2);
          // Standard stub format: { "PRICE": "COUNT" }
          prices[svc.country_code][svc.service_code][priceKey] = 100;
        });
        
        return res.json(prices);
      }

      case "getNumber": {
        let { service, country, operator, maxPrice } = query;
        if (!service) return res.send("BAD_SERVICE");
        if (!country) return res.send("BAD_COUNTRY");

        const filter = { service_code: service, country_code: country, is_active: true };
        
        // Filter by operator (Server slug) if provided
        if (operator && operator !== "any") {
          const targetServer = await Server.findOne({ slug: operator });
          if (targetServer) {
            filter.server_id = targetServer._id;
          }
        }

        // Find matching services and pick the cheapest one
        const services = await Service.find(filter).sort({ price: 1 });
        if (!services || services.length === 0) return res.send("BAD_SERVICE");

        // Pick cheapest (fist in sorted array)
        const svc = services[0];

        if (user.balance < svc.price) return res.send("NO_BALANCE");
        if (maxPrice && svc.price > parseFloat(maxPrice)) return res.send("NO_NUMBERS");

        const serverConf = await Server.findById(svc.server_id);
        if (!serverConf || !serverConf.is_active) return res.send("NO_NUMBERS");

        const providerRes = await providerApi.getNumber(serverConf, svc.service_code, country);
        if (providerRes.error) {
           return res.send("NO_NUMBERS");
        }

        // Deduct Balance
        user.balance = parseFloat((user.balance - svc.price).toFixed(4));
        user.total_spent = parseFloat((user.total_spent + svc.price).toFixed(4));
        user.total_orders += 1;
        await user.save();

        const orderId = "ORD-" + nanoid(10).toUpperCase();

        const order = await Order.create({
          order_id: orderId,
          user_id: user._id,
          service_name: svc.name,
          server_name: serverConf.name,
          country,
          phone: providerRes.phone,
          external_order_id: providerRes.api_order_id,
          cost: svc.price,
          status: "active",
          expires_at: new Date(Date.now() + (serverConf.auto_cancel_minutes || 20) * 60 * 1000),
          min_cancel_at: new Date(Date.now() + (serverConf.min_cancel_minutes || 2) * 60 * 1000),
        });

        await Transaction.create({
          user_id: user._id,
          type: "purchase",
          amount: -svc.price,
          balance_after: user.balance,
          description: `API: Purchased ${svc.name} (${country})`,
          order_id: orderId,
        });

        return res.send(`ACCESS_NUMBER:${orderId}:${providerRes.phone.replace(/\D/g, '')}`);
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

        // Check provider status
        const serverConf = await Server.findOne({ name: order.server_name });
        if (serverConf && serverConf.api_check_status_url && order.external_order_id) {
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
        return res.send("STATUS_WAIT_CODE");
      }

      case "getStatusV2": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        const ids = id.split(",").map(i => i.trim());
        // For performance, we only return the DB state in V2 bulk checks
        const orders = await Order.find({ order_id: { $in: ids }, user_id: user._id });
        
        const result = {};
        for (const order of orders) {
           if (order.status === "completed" || order.otp) {
              result[order.order_id] = `STATUS_OK:${order.otp}`;
           } else if (order.status === "cancelled" || order.status === "expired" || order.status === "refunded") {
              result[order.order_id] = "STATUS_CANCEL";
           } else {
              result[order.order_id] = "STATUS_WAIT_CODE";
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
        if (String(status) === API_STATUS_CANCEL) {
           if (order.status !== "active") {
              return res.send(order.status === "cancelled" ? "ACCESS_CANCEL_ALREADY" : "ACCESS_CANCEL");
           }
           
           // Enforce min_cancel_at (allow cancel after 2 mins only)
           if (order.min_cancel_at && Date.now() < new Date(order.min_cancel_at).getTime()) {
              const secondsLeft = Math.ceil((new Date(order.min_cancel_at).getTime() - Date.now()) / 1000);
              return res.send(`BAD_STATUS`); // Standard response for "not allowed now"
           }

           // find server directly by name stored on order
           const serverConf = await Server.findOne({ name: order.server_name });
           if (serverConf && serverConf.api_cancel_url && order.external_order_id) {
              await providerApi.cancelOrder(serverConf, order.external_order_id);
           }

           // Fully Refund
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

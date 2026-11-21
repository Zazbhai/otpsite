const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { DB_TYPE } = require("../utils/db");

router.get("/otpverse123/data", async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let topServices = [];
    let metrics = {};

    if (DB_TYPE === "mysql") {
      const { fn, col, Op } = require("sequelize");
      
      // Top Services Breakdown
      topServices = await Order.findAll({
        attributes: [
          'service_name', 
          [fn('COUNT', col('id')), 'total_purchases'], 
          [fn('SUM', col('cost')), 'total_revenue']
        ],
        where: { status: 'completed' },
        group: ['service_name'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        limit: 50
      }).then(res => res.map(r => ({
        service: r.service_name,
        purchases: parseInt(r.get('total_purchases')),
        revenue: parseFloat(r.get('total_revenue') || 0).toFixed(2)
      })));

      // General Metrics
      const [totalUsers, totalOrders, completedOrders, revRes] = await Promise.all([
        User.count(),
        Order.count(),
        Order.count({ where: { status: 'completed' } }),
        Order.findAll({ 
          attributes: [[fn('SUM', col('cost')), 'total']], 
          where: { status: 'completed' }, 
          raw: true 
        })
      ]);

      metrics = {
        total_users: totalUsers,
        total_orders: totalOrders,
        completed_orders: completedOrders,
        total_revenue: parseFloat(revRes[0]?.total || 0).toFixed(2)
      };

      const topCountries = await Order.findAll({
        attributes: ['country', [fn('COUNT', col('id')), 'count']],
        where: { status: 'completed' },
        group: ['country'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        limit: 10
      }).then(res => res.map(r => ({ name: r.country, count: r.get('count') })));

      return res.json({
        status: "success",
        timestamp: new Date().toISOString(),
        metrics,
        top_services_breakdown: topServices,
        top_countries: topCountries
      });

    } else {
      // MongoDB Aggregations
      // Top Services Breakdown with images/colors
      topServices = await Order.aggregate([
        { $match: { status: "completed" } },
        { 
          $group: { 
            _id: "$service_name", 
            purchases: { $sum: 1 }, 
            revenue: { $sum: "$cost" },
            image: { $first: "$service_image" },
            color: { $first: "$service_color" }
          } 
        },
        { $sort: { purchases: -1 } },
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            service: "$_id",
            purchases: 1,
            revenue: { $round: ["$revenue", 2] },
            image: 1,
            color: 1
          }
        }
      ]);

      const [orderStats] = await Promise.all([
        Order.aggregate([
          {
            $group: {
              _id: null,
              total_orders: { $sum: 1 },
              completed_orders: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
              total_revenue: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$cost", 0] } }
            }
          }
        ])
      ]);

      metrics = {
        total_orders: orderStats[0]?.total_orders || 0,
        completed_orders: orderStats[0]?.completed_orders || 0
      };

      res.json({
        status: "success",
        timestamp: new Date().toISOString(),
        metrics,
        top_services_breakdown: topServices
      });
    }
  } catch (err) {
    console.error("Info API Error:", err);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

module.exports = router;

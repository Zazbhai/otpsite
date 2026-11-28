const Order = require("../models/Order");
const { DB_TYPE } = require("./db");

async function rescheduleActiveOrdersForServer(server) {
  const now = new Date();
  const serverId = String(server?.id || server?._id || "").trim();
  const serverName = String(server?.name || "").trim();
  if (DB_TYPE === "mysql") {
    const { Op } = require("sequelize");
    const alternatives = [];
    if (serverId) alternatives.push({ server_id: serverId });
    if (serverName) alternatives.push({ server_name: serverName });
    if (!alternatives.length) return 0;
    const where = { status: "active", [Op.or]: alternatives };
    return Order.update({ next_check_at: now }, { where });
  }

  const alternatives = [];
  if (serverId) alternatives.push({ server_id: serverId });
  if (serverName) alternatives.push({ server_name: serverName });
  if (!alternatives.length) return { modifiedCount: 0 };
  return Order.updateMany({ status: "active", $or: alternatives }, { $set: { next_check_at: now } });
}

module.exports = { rescheduleActiveOrdersForServer };

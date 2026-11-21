const { connectDB } = require("./utils/db");
const Order = require("./models/Order");
const User = require("./models/User");
const { checkServiceNumber } = require("./utils/serviceChecker");

async function createSampleMyntraOrder() {
  await connectDB();
  console.log("Connected to DB.");

  // Find an existing user or fallback ID
  let user = await User.findOne({});
  const userId = user ? (user._id || user.id) : "69d7f977213fb43077c7a77e";

  const orderId = "ORD-MYNTRA-" + Math.floor(100000 + Math.random() * 900000);
  const samplePhone = "9262231588";

  const orderData = {
    order_id: orderId,
    user_id: userId,
    service_id: "myntra_sample_service",
    service_name: "Myntra",
    server_name: "Server 1",
    country: "India",
    phone: samplePhone,
    cost: 10.0,
    status: "active",
    expires_at: new Date(Date.now() + 20 * 60 * 1000),
    min_cancel_at: new Date(Date.now() + 2 * 60 * 1000),
    otp: "",
    all_otps: [],
    multi_otp_enabled: true
  };

  console.log("\n📦 Creating sample Myntra Order in DB...");
  const order = await Order.create(orderData);
  console.log("✅ Created Order:", {
    order_id: order.order_id,
    service_name: order.service_name,
    phone: order.phone,
    status: order.status
  });

  console.log("\n🔍 Running service registration check on the Myntra order...");
  const checkResult = await checkServiceNumber(order.service_name, order.phone);
  console.log("📋 Checker Result:", checkResult);

  process.exit(0);
}

createSampleMyntraOrder().catch(err => {
  console.error("❌ Failed to create sample Myntra order:", err);
  process.exit(1);
});

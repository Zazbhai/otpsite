const { connectDB } = require("./utils/db");
const Order = require("./models/Order");

async function run() {
  await connectDB();
  const userId = "69d7f977213fb43077c7a77e";
  
  const orders = [];
  
  // create 3 mock orders
  for (let i = 1; i <= 3; i++) {
    const orderId = "ORD-DEMO" + Math.floor(Math.random() * 100000);
    const orderData = {
      order_id: orderId,
      user_id: userId,
      service_id: "demo_service_id",
      service_name: "Demo Amazon " + i,
      server_name: "Server " + i,
      country: "India",
      phone: "91987654321" + i,
      cost: 5.5,
      status: "active",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      min_cancel_at: new Date(Date.now() + 2 * 60 * 1000),
      otp: "",
      all_otps: [],
      multi_otp_enabled: true
    };
    await Order.create(orderData);
    orders.push({ orderId, otps: [] });
    console.log("Order created:", orderId);
  }
  
  // wait 3 seconds, then push an OTP to each
  for (let round = 1; round <= 4; round++) {
    console.log(`\nWaiting 3 seconds before pushing OTP round ${round}...`);
    await new Promise(r => setTimeout(r, 3000));
    
    for (let o of orders) {
      const otp = "Code " + Math.floor(100000 + Math.random() * 900000).toString();
      o.otps.push(otp);
      
      await Order.updateOne({ order_id: o.orderId }, { 
        $set: {
          otp: otp, 
          all_otps: o.otps 
        }
      });
      console.log(`Pushed OTP ${round} to ${o.orderId}:`, otp);
    }
  }
  
  console.log("Finished pushing OTPs.");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

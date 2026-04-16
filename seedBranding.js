const mongoose = require("mongoose");
require("dotenv").config();
const Setting = require("./models/Setting");
const { connectDB } = require("./utils/db");

async function seed() {
  await connectDB();
  console.log("Seeding site branding...");
  
  const defaults = [
    { key: "site_name", value: "Zaz" },
    { key: "site_logo", value: "" },
    { key: "site_favicon", value: "" },
    { key: "primary_color", value: "#3b82f6" }
  ];

  for (const d of defaults) {
    const exists = await Setting.findOne({ key: d.key });
    if (!exists) {
      await Setting.create(d);
      console.log(`- Set ${d.key} to ${d.value}`);
    } else if (exists.value === "Rapid OTP") {
      exists.value = "Zaz";
      await exists.save();
      console.log(`- Updated ${d.key} to Zaz`);
    }
  }

  console.log("Seeding complete. Exit.");
  process.exit(0);
}

seed();

const mongoose = require("mongoose");
require("dotenv").config();

async function run() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost/test";
    console.log("Connecting to:", mongoUri);
    await mongoose.connect(mongoUri);
    console.log("Connected.");

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const servicesExists = collections.find(c => c.name === "services");

    if (servicesExists) {
      console.log("Found services collection. Checking indexes...");
      const indexes = await db.collection("services").indexes();
      console.log("Current indexes:", indexes.map(i => i.name));

      if (indexes.find(i => i.name === "slug_1")) {
        console.log("Dropping slug_1 index from services...");
        await db.collection("services").dropIndex("slug_1");
        console.log("Dropped.");
      } else {
        console.log("slug_1 index not found in services.");
      }
    } else {
      console.log("services collection not found.");
    }

    await mongoose.disconnect();
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();

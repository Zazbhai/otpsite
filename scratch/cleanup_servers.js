const { DB_TYPE } = require("../utils/db");
const mongoose = require("mongoose");
const Server = require("../models/Server");

async function run() {
    console.log("🔍 Searching for servers with invalid 'sfsdfsdf' URLs...");
    
    // Connect if needed (server.js usually handles this but we are a separate script)
    if (DB_TYPE === "mongodb") {
        await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/otp-site");
    }

    const servers = await Server.find({
        $or: [
            { api_get_number_url: /sfsdfsdf/ },
            { api_check_status_url: /sfsdfsdf/ },
            { api_cancel_url: /sfsdfsdf/ },
            { api_retry_url: /sfsdfsdf/ }
        ]
    });

    if (servers.length === 0) {
        console.log("✅ No bad servers found.");
        process.exit(0);
    }

    console.log(`❌ Found ${servers.length} bad servers:`);
    for (const s of servers) {
        console.log(` - ID: ${s._id}, Name: ${s.name}, URL: ${s.api_get_number_url}`);
    }

    // Uncomment below to actually delete them
    // await Server.deleteMany({ _id: { $in: servers.map(s => s._id) } });
    // console.log("🗑️ Deleted bad servers.");

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});

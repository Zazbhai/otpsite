
const { connectDB, sequelize, DB_TYPE } = require("./utils/db");
const Service = require("./models/Service");
const Server = require("./models/Server");
const Country = require("./models/Country");

async function diagnose() {
    console.log("=== DATABASE DIAGNOSTIC START ===");
    console.log("DB_TYPE:", DB_TYPE);
    
    try {
        await connectDB();
        console.log("✅ Connection Successful");
        
        // 1. Check Tables
        const tables = await sequelize.getQueryInterface().showAllTables();
        console.log("Tables in database:", tables);
        
        // 2. Check Service Data
        console.log("\n--- Checking Services ---");
        const services = await Service.findAll({ limit: 5 });
        console.log(`Found ${services.length} services.`);
        services.forEach(s => {
            const data = s.get({ plain: true });
            console.log(`- Service: ${data.name}, server_id: ${data.server_id_attr || data.server_id} (Type: ${typeof (data.server_id_attr || data.server_id)})`);
        });
        
        // 3. Check Server Data
        console.log("\n--- Checking Servers ---");
        const servers = await Server.findAll({ limit: 5 });
        console.log(`Found ${servers.length} servers.`);
        servers.forEach(s => {
            const data = s.get({ plain: true });
            console.log(`- Server ID: ${data.id}, Name: ${data.name}, country_id: ${data.country_id_attr || data.country_id}`);
        });

        // 4. Test Manual Join
        console.log("\n--- Testing Manual Join ---");
        if (services.length > 0) {
            const firstSvc = services[0];
            const testPop = await Service.findByPk(firstSvc.id, {
                include: [{ association: 'server_id', include: ['country_id'] }]
            });
            console.log("Join result server_id populated:", !!testPop.server_id);
            if (testPop.server_id) {
                console.log("Server Name found via join:", testPop.server_id.name);
                console.log("Country found via join:", testPop.server_id.country_id ? testPop.server_id.country_id.name : "NULL");
            }
        }

    } catch (err) {
        console.error("❌ Diagnostic Failed:", err);
    } finally {
        console.log("\n=== DIAGNOSTIC COMPLETE ===");
        process.exit(0);
    }
}

diagnose();

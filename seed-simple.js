
const mongoose = require('mongoose');
const { connectDB } = require('./utils/db');
const Order = require('./models/Order');

async function seedSimple() {
    try {
        await connectDB();
        
        // Clear all previous test orders
        await Order.deleteMany({ order_id: /^ORD-(FINAL|MASS|COMPACT|TEST)/ });

        const userId = '69d7f8e30f20ff14e0fd23db'; 

        const samples = [
            {
                name: 'Flipkart',
                color: '#2874f0',
                img: 'https://static-assets-web.flixcart.com/batman-returns/batman-returns/p/images/logo_lite-cbb357.png',
                sms: 'Your Flipkart otp is 99223 for your 3234 account'
            },
            {
                name: 'Google',
                color: '#4285f4',
                img: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_2015_logo.svg',
                sms: 'G-123456 is your Google verification code.'
            }
        ];

        for (const s of samples) {
            const order = new Order({
                order_id: `ORD-TEST-${Math.random().toString(36).substring(7).toUpperCase()}`,
                user_id: userId,
                service_id: s.name.toLowerCase(),
                service_name: s.name,
                service_color: s.color,
                service_image: s.img,
                country: 'India',
                country_name: 'India',
                country_flag: '🇮🇳',
                server_name: 'Premium Node 1',
                phone: `+91${Math.floor(6000000000 + Math.random() * 3000000000)}`,
                status: 'active',
                cost: 15.00,
                otp: s.sms,
                all_otps: [s.sms],
                expires_at: new Date(Date.now() + 15 * 60000),
                min_cancel_at: new Date(Date.now() + 2 * 60000),
                createdAt: new Date()
            });
            await order.save();
            console.log(`✅ Created: ${order.order_id} (${s.name})`);
        }

        console.log('\n✨ 2 test orders created.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

seedSimple();

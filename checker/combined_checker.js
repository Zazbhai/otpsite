const http = require('http');
const { checkServiceNumber, SUPPORTED_SERVICES, SERVICE_DISPLAY_NAMES } = require('../utils/serviceChecker');

const serviceOptionsHtml = SUPPORTED_SERVICES.map(key => {
  const label = SERVICE_DISPLAY_NAMES[key] || key;
  return `        <option value="${key}">${label}</option>`;
}).join('\n');

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapid OTP - SuperAssets Number Checker</title>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
body { height: 100vh; background: #020617; color: white; overflow: hidden; }

/* ✨ STAR BACKGROUND */
.stars::before, .stars::after {
    content: ""; position: absolute; width: 2px; height: 2px; background: white;
    box-shadow: 10vw 20vh white, 30vw 40vh white, 50vw 60vh white, 70vw 80vh white, 90vw 30vh white, 20vw 70vh white;
    animation: twinkle 6s infinite linear;
}
.stars::after { animation-delay: 3s; opacity: 0.5; }
@keyframes twinkle { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }

/* 📦 CONTAINER */
.container {
    position: relative; z-index: 2; backdrop-filter: blur(12px);
    background: rgba(255,255,255,0.05); padding: 25px; border-radius: 15px;
    width: 90%; max-width: 380px; text-align: center; margin: auto;
    top: 50%; transform: translateY(-50%);
    border: 1px solid rgba(255,255,255,0.1);
}

.brand { font-size: 13px; opacity: 0.7; margin-bottom: 5px; }

select, input {
    width: 100%; padding: 12px; margin-top: 12px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: white;
    font-size: 14px; outline: none;
}
select option { background: #020617; color: white; }

button {
    width: 100%; padding: 12px; margin-top: 15px; border-radius: 8px;
    border: none; background: linear-gradient(45deg, #ffd800, #facc15);
    color: #020617; font-weight: 700; cursor: pointer; transition: 0.2s;
    font-size: 14px;
}
button:active { transform: scale(0.96); }
button:disabled { opacity: 0.7; cursor: not-allowed; }

.result { margin-top: 15px; font-weight: bold; opacity: 0; transition: 0.3s; padding: 10px; border-radius: 8px; }

.registered { color: #f87171; background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.2); }
.not_registered { color: #4ade80; background: rgba(74, 222, 128, 0.1); border: 1px solid rgba(74, 222, 128, 0.2); }
.error-msg { color: #fbbf24; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); }

/* SPINNER */
.loader {
    display: none; width: 20px; height: 20px; border: 3px solid rgba(0,0,0,0.2);
    border-top: 3px solid #000; border-radius: 50%; animation: spin 1s linear infinite;
    margin: 0 auto;
}
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
</style>
</head>
<body>

<div class="stars"></div>

<div class="container">
    <h2>Number Checker</h2>
    <p class="brand">Powered by SuperAssets API</p>

    <select id="service">
${serviceOptionsHtml}
    </select>

    <input type="text" id="mobile" placeholder="Enter 10-digit number" maxlength="10" 
           oninput="this.value = this.value.replace(/[^0-9]/g, '')">

    <button id="checkBtn" onclick="checkNumber()">
        <span id="btnText">Check Status</span>
        <div class="loader" id="loader"></div>
    </button>

    <div id="result" class="result"></div>
</div>

<script>
async function checkNumber() {
    const mobile = document.getElementById('mobile').value;
    const service = document.getElementById('service').value;
    const resultDiv = document.getElementById('result');
    const btnText = document.getElementById('btnText');
    const loader = document.getElementById('loader');
    const btn = document.getElementById('checkBtn');

    if (mobile.length !== 10) {
        resultDiv.innerText = "Please enter a valid 10-digit number.";
        resultDiv.className = "result error-msg";
        resultDiv.style.opacity = "1";
        return;
    }

    // Loading State
    btn.disabled = true;
    btnText.style.display = 'none';
    loader.style.display = 'block';
    resultDiv.style.opacity = "0";

    try {
        const response = await fetch('/api/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile, service })
        });

        const data = await response.json();

        if (data.status === 'registered') {
            resultDiv.innerText = "⚠️ ALREADY REGISTERED";
            resultDiv.className = "result registered";
        } else if (data.status === 'not_registered') {
            resultDiv.innerText = "✅ FRESH (Not Registered)";
            resultDiv.className = "result not_registered";
        } else {
            resultDiv.innerText = "⚠️ ERROR: " + (data.error || "Unknown error");
            resultDiv.className = "result error-msg";
        }
    } catch (error) {
        resultDiv.innerText = "⚠️ SERVER ERROR: " + error.message;
        resultDiv.className = "result error-msg";
    }

    // Reset State
    resultDiv.style.opacity = "1";
    btn.disabled = false;
    btnText.style.display = 'block';
    loader.style.display = 'none';
}
</script>

</body>
</html>`;

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/check') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        
        req.on('end', async () => {
            res.setHeader('Content-Type', 'application/json');
            
            let mobile = '';
            let service = '';
            
            try {
                const parsed = JSON.parse(body);
                mobile = parsed.mobile || '';
                service = parsed.service || '';
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }

            if (!mobile || mobile.length !== 10 || isNaN(mobile)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid number' }));
                return;
            }

            console.log(`\n========================================`);
            console.log(`[SuperAssets Checker] Service: ${service} | Mobile: ${mobile}`);
            console.log(`========================================`);

            const result = await checkServiceNumber(service, mobile);
            res.writeHead(result.success ? 200 : (result.status === 'invalid_number' ? 400 : 200));
            res.end(JSON.stringify(result));
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML);
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => {
      console.log(`Unified SuperAssets Checker Server is running on http://localhost:${PORT}`);
  });
}

module.exports = server;

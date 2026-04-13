
const fs = require('fs');
const content = fs.readFileSync('c:/Users/zgarm/OneDrive/Desktop/Otp Site/public/js/main.js', 'utf8');

let stack = [];
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let j = 0; j < line.length; j++) {
        let char = line[j];
        if (char === '{') {
            stack.push({ line: i + 1, col: j + 1 });
        } else if (char === '}') {
            if (stack.length === 0) {
                console.log(`Extra closing brace at ${i + 1}:${j + 1}`);
            } else {
                stack.pop();
            }
        }
    }
}

stack.forEach(s => {
    console.log(`Unclosed brace at ${s.line}:${s.col}`);
});

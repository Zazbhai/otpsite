/**
 * AMBIENT PARTICLE BACKGROUND
 * Automatically creates a high-performance 2D particle canvas
 * Optimized for low-end devices and high-DPI displays.
 */
(function() {
    if (document.getElementById('ambient-space')) return;
    
    const canvas = document.createElement('canvas');
    canvas.id = 'ambient-space';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '-1'; // Behind everything
    canvas.style.pointerEvents = 'none'; // Content remains clickable
    document.body.style.background = 'transparent';
    document.body.style.backgroundImage = 'none';
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d', { alpha: false });
    let width, height;
    let particles = [];
    let numParticles = window.innerWidth < 600 ? 40 : 100;
    let isAnimating = true;

    function initCanvas() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        numParticles = window.innerWidth < 600 ? 50 : 120;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
    }

    function hexToRgba(hex, alpha) {
        let r = 255, g = 179, b = 0;
        if (hex.startsWith('#')) {
            const h = hex.replace('#', '');
            if (h.length === 3) {
                r = parseInt(h[0] + h[0], 16);
                g = parseInt(h[1] + h[1], 16);
                b = parseInt(h[2] + h[2], 16);
            } else if (h.length === 6) {
                r = parseInt(h.substring(0, 2), 16);
                g = parseInt(h.substring(2, 4), 16);
                b = parseInt(h.substring(4, 6), 16);
            }
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function createParticles() {
        particles = [];
        const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
        
        for (let i = 0; i < numParticles; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 2.4,
                vy: (Math.random() - 0.5) * 2.4,
                size: Math.random() * 3 + 1,
                color: hexToRgba(themeColor, Math.random() * 0.4 + 0.2)
            });
        }
    }

    function animate() {
        if (!isAnimating) return;
        requestAnimationFrame(animate);

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            ctx.fillStyle = p.color;
            ctx.fillRect(Math.trunc(p.x), Math.trunc(p.y), Math.trunc(p.size), Math.trunc(p.size));
        });
    }

    window.addEventListener('resize', () => {
        initCanvas();
        createParticles();
    });

    document.addEventListener('visibilitychange', () => {
        isAnimating = !document.hidden;
        if (isAnimating) animate();
    });

    window.addEventListener('themeChanged', () => {
        createParticles();
    });

    initCanvas();
    createParticles();
    animate();
})();

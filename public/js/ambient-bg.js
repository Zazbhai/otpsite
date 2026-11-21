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
    canvas.style.pointerEvents = 'none'; // Content remains clickable
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    let width, height;
    let particles = [];
    let isAnimating = true;

    function initCanvas() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, width, height);
    }

    function createParticles() {
        particles = [];
        const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
        // Extreme optimization for mobile/low-end
        const isMobile = width < 768;
        const particleCount = isMobile ? 30 : 60; 

        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: Math.random() * 1.2 + 0.3,
                speedX: (Math.random() - 0.5) * 0.3,
                speedY: (Math.random() - 0.5) * 0.3,
                opacity: Math.random() * 0.3 + 0.1,
                color: themeColor
            });
        }
    }

    function animate() {
        if (!isAnimating) return;

        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            
            p.x += p.speedX;
            p.y += p.speedY;

            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = p.color;
            // Use bitwise for floor
            ctx.fillRect(p.x | 0, p.y | 0, p.size | 0 || 1, p.size | 0 || 1);
        }
        ctx.globalAlpha = 1.0;
        
        requestAnimationFrame(animate);
    }


    window.addEventListener('resize', () => {
        const oldW = width;
        const oldH = height;
        initCanvas();
        // Only recreate if dimensions changed significantly to prevent flickering on mobile scroll
        if (Math.abs(oldW - width) > 50 || Math.abs(oldH - height) > 50) {
            createParticles();
        }
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

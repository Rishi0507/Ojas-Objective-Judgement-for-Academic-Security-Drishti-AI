'use client';

import React, { useEffect, useRef, useState } from 'react';

export default function FluidFlowGrid() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        setIsDarkMode(mediaQuery.matches);
        const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        let animationFrameId: number;
        let width = 0;
        let height = 0;

        const mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };

        const handleResize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.scale(dpr, dpr);
        };

        const handleMouseMove = (e: MouseEvent) => {
            mouse.targetX = e.clientX;
            mouse.targetY = e.clientY;
        };

        const handleMouseLeave = () => {
            mouse.targetX = -1000;
            mouse.targetY = -1000;
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        let time = 0;

        const render = () => {
            time += 0.008;

            // Mouse smooth interpolation
            mouse.x += (mouse.targetX - mouse.x) * 0.08;
            mouse.y += (mouse.targetY - mouse.y) * 0.08;

            // Tailored for warm-canvas & dark contrast in Drishti AI theme
            const bgColor = isDarkMode ? '#080d1a' : '#f0f7ff';
            const lineBaseColor = isDarkMode ? '59, 130, 246' : '30, 64, 175'; // Neutral Slate-Blue
            const accentBlue = isDarkMode ? '147, 197, 253' : '29, 78, 216';

            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);

            const spacing = 35;
            const cols = Math.ceil(width / spacing) + 1;
            const rows = Math.ceil(height / spacing) + 1;

            ctx.lineWidth = 1.2;

            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const x = i * spacing;
                    const y = j * spacing;

                    // Trigonometric fluid turbulence angle
                    let angle = Math.sin(x * 0.003 + time) + Math.cos(y * 0.003 + time);

                    // Distance to mouse force field
                    const dx = mouse.x - x;
                    const dy = mouse.y - y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    let isNear = false;
                    if (dist < 220 && dist > 0) {
                        isNear = true;
                        const pushAngle = Math.atan2(dy, dx) + Math.PI;
                        const force = (1 - dist / 220);
                        angle = angle * (1 - force) + pushAngle * force;
                    }

                    const lineLen = isNear ? 22 : 14;
                    const x2 = x + Math.cos(angle) * lineLen;
                    const y2 = y + Math.sin(angle) * lineLen;

                    const alpha = isNear
                        ? 0.8
                        : (0.15 + Math.sin(x * 0.01 + y * 0.01 + time) * 0.1);

                    ctx.strokeStyle = isNear
                        ? `rgba(${accentBlue}, ${alpha})`
                        : `rgba(${lineBaseColor}, ${alpha})`;

                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [isDarkMode]);

    return (
        <div className="absolute inset-0 w-full h-full overflow-hidden select-none pointer-events-none opacity-40">
            <canvas ref={canvasRef} className="absolute inset-0 block" />
        </div>
    );
}

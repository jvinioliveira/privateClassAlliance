import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type AnimatedSavingsCounterProps = {
  valueCents: number;
  isActive: boolean;
  durationMs?: number;
  className?: string;
};

const formatCurrencyBRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);

const AnimatedSavingsCounter = ({
  valueCents,
  isActive,
  durationMs = 700,
  className,
}: AnimatedSavingsCounterProps) => {
  const [displayCents, setDisplayCents] = useState(0);
  const [isInView, setIsInView] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setDisplayCents(0);
    setHasAnimated(false);
  }, [valueCents]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || hasAnimated) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.45 },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [hasAnimated]);

  useEffect(() => {
    if (hasAnimated || valueCents <= 0 || (!isInView && !isActive)) return;

    const start = performance.now();
    let rafId = 0;

    const animate = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayCents(Math.round(valueCents * eased));

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        setDisplayCents(valueCents);
        setHasAnimated(true);
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafId);
  }, [durationMs, hasAnimated, isActive, isInView, valueCents]);

  return (
    <span ref={containerRef} className={cn('tabular-nums', className)}>
      {formatCurrencyBRL(displayCents)}
    </span>
  );
};

export default AnimatedSavingsCounter;

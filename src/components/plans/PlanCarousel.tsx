import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { cn } from '@/lib/utils';

type PlanCarouselProps<T> = {
  plans: T[];
  renderPlanCard: (plan: T, index: number, state: { isActive: boolean; distance: number }) => React.ReactNode;
  getPlanKey: (plan: T, index: number) => string;
  primaryPlanIndex?: number;
  focusPlanIndex?: number | null;
  autoRotateMs?: number;
  className?: string;
};

const PlanCarousel = <T,>({
  plans,
  renderPlanCard,
  getPlanKey,
  primaryPlanIndex,
  focusPlanIndex,
  autoRotateMs = 7000,
  className,
}: PlanCarouselProps<T>) => {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [snapCount, setSnapCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const hasCenteredPrimaryRef = useRef(false);
  const pauseTimeoutRef = useRef<number | null>(null);

  const hasMultiple = plans.length > 1;

  const pauseAutoRotate = () => setIsPaused(true);

  const resumeAutoRotateSoon = () => {
    if (pauseTimeoutRef.current) window.clearTimeout(pauseTimeoutRef.current);
    pauseTimeoutRef.current = window.setTimeout(() => {
      setIsPaused(false);
      pauseTimeoutRef.current = null;
    }, 900);
  };

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) window.clearTimeout(pauseTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!api) return;

    const update = () => {
      setSelectedIndex(api.selectedScrollSnap());
      setSnapCount(api.scrollSnapList().length);
    };

    update();
    api.on('select', update);
    api.on('reInit', update);

    return () => {
      api.off('select', update);
      api.off('reInit', update);
    };
  }, [api]);

  useEffect(() => {
    hasCenteredPrimaryRef.current = false;
  }, [plans]);

  useEffect(() => {
    if (!api || primaryPlanIndex === undefined || primaryPlanIndex < 0 || hasCenteredPrimaryRef.current) return;
    api.scrollTo(primaryPlanIndex, true);
    hasCenteredPrimaryRef.current = true;
  }, [api, primaryPlanIndex]);

  useEffect(() => {
    if (!api || focusPlanIndex === undefined || focusPlanIndex === null || focusPlanIndex < 0) return;
    pauseAutoRotate();
    api.scrollTo(focusPlanIndex);
    resumeAutoRotateSoon();
  }, [api, focusPlanIndex]);

  useEffect(() => {
    if (!api || !hasMultiple || isPaused) return;
    const timer = window.setInterval(() => {
      api.scrollNext();
    }, autoRotateMs);
    return () => window.clearInterval(timer);
  }, [api, autoRotateMs, hasMultiple, isPaused]);

  const dots = useMemo(() => Array.from({ length: snapCount }), [snapCount]);
  const getDistanceFromActive = (index: number) => {
    if (!snapCount || !hasMultiple) return 0;
    const raw = Math.abs(index - selectedIndex);
    return Math.min(raw, snapCount - raw);
  };

  return (
    <div
      className={cn('space-y-3', className)}
      onMouseEnter={pauseAutoRotate}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={pauseAutoRotate}
      onTouchEnd={resumeAutoRotateSoon}
      onFocusCapture={pauseAutoRotate}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          resumeAutoRotateSoon();
        }
      }}
    >
      <Carousel
        setApi={setApi}
        opts={{
          loop: hasMultiple,
          align: 'center',
        }}
      >
        <CarouselContent className="-ml-2 md:-ml-4">
          {plans.map((plan, index) => {
            const distance = getDistanceFromActive(index);
            const isActive = distance === 0;
            const itemClassName = cn(
              'transition-all duration-500 ease-in-out transform-gpu',
              isActive && 'scale-100 opacity-100',
              distance === 1 && 'scale-[0.965] opacity-80',
              distance >= 2 && 'scale-[0.94] opacity-65',
            );

            return (
              <CarouselItem
                key={getPlanKey(plan, index)}
                className="basis-full pl-2 py-2 md:basis-1/2 md:pl-4 lg:basis-1/3"
              >
                <div className={itemClassName}>{renderPlanCard(plan, index, { isActive, distance })}</div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>

      {hasMultiple && (
        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => {
              pauseAutoRotate();
              api?.scrollPrev();
              resumeAutoRotateSoon();
            }}
            aria-label="Plano anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1.5">
            {dots.map((_, index) => (
              <button
                key={`dot-${index}`}
                type="button"
                aria-label={`Ir para plano ${index + 1}`}
                onClick={() => {
                  pauseAutoRotate();
                  api?.scrollTo(index);
                  resumeAutoRotateSoon();
                }}
                className={cn(
                  'h-2 rounded-full transition-all',
                  selectedIndex === index ? 'w-5 bg-primary' : 'w-2 bg-muted-foreground/40',
                )}
              />
            ))}
          </div>

          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => {
              pauseAutoRotate();
              api?.scrollNext();
              resumeAutoRotateSoon();
            }}
            aria-label="Próximo plano"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default PlanCarousel;

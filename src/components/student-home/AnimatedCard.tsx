import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';

const defaultCardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.42,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

interface AnimatedCardProps extends HTMLMotionProps<'section'> {
  hoverable?: boolean;
}

const AnimatedCard = ({ className, children, hoverable = true, variants, ...props }: AnimatedCardProps) => {
  return (
    <motion.section
      variants={variants ?? defaultCardVariants}
      whileHover={hoverable ? { y: -2, scale: 1.01 } : undefined}
      whileTap={hoverable ? { scale: 0.995 } : undefined}
      className={cn(
        'overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-[0_18px_38px_-28px_rgba(0,0,0,0.85)] backdrop-blur',
        className,
      )}
      {...props}
    >
      {children}
    </motion.section>
  );
};

export default AnimatedCard;

import { motion, type Variants } from 'framer-motion';

const headerVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

interface WelcomeHeaderProps {
  studentName: string;
  subtitle: string;
}

const WelcomeHeader = ({ studentName, subtitle }: WelcomeHeaderProps) => {
  return (
    <motion.header variants={headerVariants} className="space-y-1.5 px-0.5">
      <h1 className="text-2xl tracking-tight text-foreground sm:text-[2rem]">
        Olá, <span className="text-gold-gradient">{studentName}</span>
      </h1>
      <p className="max-w-xl text-sm text-muted-foreground sm:text-base">{subtitle}</p>
    </motion.header>
  );
};

export default WelcomeHeader;

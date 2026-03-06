import { useState } from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showImageOnMobile?: boolean;
  stacked?: boolean;
}

const sizeMap = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-14',
  xl: 'h-20',
};

const logoSources = [
  '/image/logo-alliance.png',
  '/logo-alliance.png',
  '/assets/logo.png',
];

const logoTitle = 'ALLIANCE JIU JITSU | SÃO JOSÉ DOS PINHAIS';

const Logo = ({
  className = '',
  size = 'md',
  showImageOnMobile = false,
  stacked = false,
}: LogoProps) => {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [showFallback, setShowFallback] = useState(false);

  const currentSource = logoSources[sourceIndex];

  return (
    <div
      className={`flex ${stacked ? 'flex-col items-center text-center' : 'items-center'} gap-2 ${className}`}
    >
      {!showFallback && (
        <img
          src={currentSource}
          alt="Alliance"
          className={`${sizeMap[size]} ${showImageOnMobile ? 'block' : 'hidden sm:block'} w-auto object-contain`}
          onError={() => {
            const nextIndex = sourceIndex + 1;
            if (nextIndex < logoSources.length) {
              setSourceIndex(nextIndex);
              return;
            }
            setShowFallback(true);
          }}
        />
      )}
      <span
        className="text-primary font-bold tracking-wider uppercase text-[10px] sm:text-sm"
        style={{ fontFamily: 'Roboto, sans-serif' }}
      >
        {logoTitle}
      </span>
    </div>
  );
};

export default Logo;

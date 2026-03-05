interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-14',
};

const Logo = ({ className = '', size = 'md' }: LogoProps) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src="/assets/logo.png"
        alt="Alliance Jiu-Jitsu"
        className={`${sizeMap[size]} w-auto object-contain`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
          const parent = (e.target as HTMLImageElement).parentElement;
          if (parent && !parent.querySelector('.logo-fallback')) {
            const fallback = document.createElement('span');
            fallback.className = 'logo-fallback font-display text-primary font-bold tracking-wider';
            fallback.textContent = 'ALLIANCE';
            parent.appendChild(fallback);
          }
        }}
      />
      <span className="font-display text-primary font-bold tracking-wider uppercase hidden sm:inline">
        Alliance
      </span>
    </div>
  );
};

export default Logo;

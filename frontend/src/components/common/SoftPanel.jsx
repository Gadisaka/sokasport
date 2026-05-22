/** Soft glassy surface — matches deposit / auth account palette */
export function SoftPanel({ children, className = "", style }) {
  return (
    <div
      style={style}
      className={`sb-card rounded-[1.75rem] px-5 py-6 backdrop-blur-md transition-shadow duration-500 ${className}`}
    >
      {children}
    </div>
  );
}

export default SoftPanel;

/** Glassy surface — aligns with SoftPanel / MainLayout chrome */
function Panel({
  as: Component = "section",
  className = "",
  children,
  ...rest
}) {
  return (
    <Component
      className={`sb-card rounded-[1.15rem] backdrop-blur-sm ${className}`.trim()}
      {...rest}
    >
      {children}
    </Component>
  );
}

export default Panel;

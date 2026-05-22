function PageContainer({ children }) {
  return (
    <div className="min-h-screen bg-transparent text-(--sb-text)">
      {children}
    </div>
  );
}

export default PageContainer;

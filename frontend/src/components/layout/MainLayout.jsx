function MainLayout({ left, center, right }) {
  return (
    <div className="grid items-start gap-2.5 px-2 pb-2 pt-1 sm:px-3 max-lg:grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_260px] xl:grid-cols-[200px_minmax(0,1fr)_280px] 2xl:grid-cols-[228px_minmax(0,1fr)_330px]">
      <aside className="hidden min-w-0 flex-col gap-2 overflow-hidden rounded-[1.35rem] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.5)] backdrop-blur-sm lg:sticky lg:top-[112px] lg:flex lg:min-h-0 lg:max-h-[calc(100vh-112px)]">
        {left}
      </aside>
      <div className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-[1.35rem] shadow-[0_20px_50px_-18px_rgba(0,0,0,0.55)] backdrop-blur-sm max-lg:order-1">
        {center}
      </div>
      <aside className="hidden min-w-0 overflow-y-auto rounded-[1.35rem] shadow-[0_16px_40px_-20px_rgba(0,0,0,0.5)] backdrop-blur-sm lg:sticky lg:top-[112px] lg:block lg:max-h-[calc(100vh-112px)]">
        {right}
      </aside>
    </div>
  );
}

export default MainLayout;

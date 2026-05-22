function BetSlipItem({ title, subtitle, odd }) {
  return (
    <article className="flex justify-between gap-2 border-b border-b-[#32304b] p-2.5">
      <div>
        <h4 className="m-0 text-sm font-bold">{title}</h4>
        <p className="mt-0.5 mb-0 text-[13px] font-medium text-[#c4c8dd]">{subtitle}</p>
      </div>
      <div className="text-lg font-extrabold text-(--sb-positive)">{odd}</div>
    </article>
  )
}

export default BetSlipItem

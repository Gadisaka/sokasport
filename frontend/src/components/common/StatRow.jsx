function StatRow({ label, value, accent = false }) {
  return (
    <div className="flex justify-between gap-1.5 px-2.5 py-1.5 text-[15px] font-semibold text-[#d2d4e7]">
      <span>{label}</span>
      <strong className={accent ? 'text-(--sb-accent-text-soft)' : 'text-(--sb-accent-text-muted)'}>{value}</strong>
    </div>
  )
}

export default StatRow

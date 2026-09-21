export default function MediaLoading() {
  return (
    <div className="space-y-5" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-xl bg-raised" />
        <div className="space-y-2">
          <div className="h-6 w-28 animate-pulse rounded bg-raised" />
          <div className="h-4 w-72 max-w-[70vw] animate-pulse rounded bg-raised" />
        </div>
      </div>
      <div className="flex gap-2 border-b border-line pb-3">
        {[5, 6, 5, 7].map((width, index) => <div key={index} className="h-8 animate-pulse rounded bg-raised" style={{ width: `${width}rem` }} />)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => <div key={index} className="aspect-[2/3] animate-pulse rounded-card bg-raised" />)}
      </div>
    </div>
  );
}

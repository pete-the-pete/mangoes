export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-orange-400 via-rose-400 to-teal-600 px-6 text-center">
      <span className="text-[9rem] leading-none drop-shadow-lg sm:text-[13rem]" role="img" aria-label="mango">
        🥭
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-white drop-shadow sm:text-3xl">
        Mango Tracker
      </h1>
      <p className="text-lg font-medium text-white/90">Coming soon</p>
    </div>
  );
}

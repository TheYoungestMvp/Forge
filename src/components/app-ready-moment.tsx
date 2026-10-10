"use client";

export function AppReadyMoment({
  title,
  versionNumber,
  fresh,
}: {
  title: string;
  versionNumber: number;
  fresh: boolean;
}) {
  return (
    <div className="app-ready-moment" data-fresh={fresh}>
      <svg className="ready-imprint" viewBox="0 0 48 48" aria-hidden="true">
        <path
          className="ready-contour"
          d="M6 15C3 10 8 4 17 4h14c9 0 14 6 11 15l-2 13c-1 9-7 13-16 12S8 39 7 32Z"
        />
        <rect
          className="ready-window"
          x="9"
          y="10"
          width="30"
          height="27"
          rx="5"
          pathLength="1"
        />
        <path className="ready-window-bar" d="M9 19h30" pathLength="1" />
        <path className="ready-content" d="M15 25h9M15 30h5" />
        <path className="ready-pointer" d="m28 26 11 9-6 1-4 5Z" />
      </svg>
      <div className="app-ready-copy">
        <h3 title={title}>{title}</h3>
        <span className="ready-version">v{versionNumber}</span>
      </div>
    </div>
  );
}

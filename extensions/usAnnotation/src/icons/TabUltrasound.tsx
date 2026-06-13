import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement>;

/** Side-panel tab icon: ultrasound sector with full-size tab-linear measurement. */
export default function TabUltrasound(props: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <clipPath id="tab-ultrasound-sector">
          <path d="M5 3.5Q11 1.25 17 3.5L20.25 20Q11 21.25 1.75 20Z" />
        </clipPath>
      </defs>
      <g fill="none" fillRule="evenodd">
        <g
          clipPath="url(#tab-ultrasound-sector)"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="0.75"
          opacity="0.55"
        >
          <path d="M6 7.5Q7.25 7 8.5 7.5Q9.75 8 11 7.5Q12.25 7 13.5 7.5Q14.75 8 16 7.5Q17.25 7 18.5 7.5" />
          <path d="M5.5 10Q6.9 9.45 8.3 10Q9.7 10.55 11.1 10Q12.5 9.45 13.9 10Q15.3 10.55 16.7 10Q18.1 9.45 19.5 10" />
          <path d="M5 12.5Q6.55 11.85 8.1 12.5Q9.65 13.15 11.2 12.5Q12.75 11.85 14.3 12.5Q15.85 13.15 17.4 12.5Q18.95 11.85 20.5 12.5" />
          <path d="M4.5 15Q6.2 14.3 7.9 15Q9.6 15.7 11.3 15Q13 14.3 14.7 15Q16.4 15.7 18.1 15Q19.8 14.3 21.5 15" />
          <path d="M4 17.5Q5.85 16.75 7.7 17.5Q9.55 18.25 11.4 17.5Q13.25 16.75 15.1 17.5Q16.95 18.25 18.8 17.5Q20.65 16.75 22.5 17.5" />
        </g>
        <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3.5Q11 1.25 17 3.5" />
          <path d="M5 3.5L1.75 20" />
          <path d="M17 3.5L20.25 20" />
          <path d="M1.75 20Q11 21.25 20.25 20" />
        </g>
        <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="16.37" width="4.13" height="4.13" rx="1" />
          <rect x="16.37" y="1.5" width="4.13" height="4.13" rx="1" />
          <path d="M5.388 16.612 16.612 5.388" />
        </g>
        <path d="M0 0h22v22H0z" />
      </g>
    </svg>
  );
}

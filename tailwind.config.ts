import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#f7f8fb",
          800: "#f1f3f7",
          700: "#e6eaf1",
          600: "#d5dbe6",
          500: "#c3cad8",
          300: "#667085",
          100: "#111827"
        },
        glow: {
          cyan: "#10a37f",
          mint: "#4cc38a",
          violet: "#6b8cff"
        }
      },
      boxShadow: {
        "soft": "0 12px 30px rgba(17,24,39,0.08)",
        "glow": "0 0 24px rgba(16,163,127,0.35)"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "pulse-dots": {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.4" },
          "40%": { transform: "scale(1)", opacity: "1" }
        },
        "glow-sweep": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(120%)" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out",
        "pulse-dots": "pulse-dots 1.2s ease-in-out infinite",
        "glow-sweep": "glow-sweep 2.8s ease-in-out infinite"
      }
    }
  },
  plugins: []
} satisfies Config;

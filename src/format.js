// Display formatting.

export function fmt(n, dec = 0) {
return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dec }).format(Math.abs(n));
}

export function ordinal(n) {
const s = ["th","st","nd","rd"];
const v = n % 100;
return n + (s[(v-20)%10] || s[v] || s[0]);
}

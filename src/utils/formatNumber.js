export function formatNumber(num, digits = 1) {
    const lookup = [
        { value: 1e18, symbol: 'E' },
        { value: 1e15, symbol: 'P' },
        { value: 1e12, symbol: 'T' },
        { value: 1e9, symbol: 'B' },
        { value: 1e6, symbol: 'M' },
        { value: 1e3, symbol: 'K' },
        { value: 1, symbol: '' },
    ];

    const item = lookup.find((item) => num >= item.value);
    if (item) {
        const formatted = (num / item.value).toFixed(digits);
        // Remove unnecessary trailing zeros and decimal points
        return (
            formatted.replace(/\.0+$|(\.[0-9]*[1-9])0+$/, '$1') + item.symbol
        );
    }
    return '0';
}

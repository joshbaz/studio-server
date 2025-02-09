/**
 * Converts a bitrate value (in bits per second) to a human-readable string.
 *
 * @param {number} bitrate The bitrate in bits per second.
 * @param {number} [decimals=2] The number of decimal places to include.
 * @returns {string} The human-readable bitrate string (e.g., "705.86 Kbps", "1.23 Mbps").
 */
export const formatBitrate = (bitrate, decimals = 2) => {
    if (typeof bitrate !== 'number') {
        throw new Error('Bitrate must be a number.');
    }

    const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
    let i = 0;

    while (bitrate >= 1000 && i < units.length - 1) {
        bitrate /= 1000;
        i++;
    }

    return `${bitrate.toFixed(decimals)} ${units[i]}`;
};

const resolutions = ['SD', 'HD', 'FHD', 'UHD'];

/**
 * @name resSelector
 * @description Function to determine allowed resolutions based on purchased resolution
 * @param {"SD" | "HD" | "FHD" | "UHD"} resolution
 * @returns {Array<"SD" | "HD" | "FHD" | "UHD">}
 * @example
    ```javascript
    import {resSelector} from "@/utils/resSelector.js"

    const selectedRes = resSelector("FHD")
    console.log(selectedRes) // ["SD", "HD", "FHD"]
    ```
 */
export function resSelector(resolution) {
    const purchasedIndex = resolutions.indexOf(resolution);

    if (purchasedIndex === -1) {
        console.error('Invalid purchased resolution:', purchasedResolution);
        return []; // Or throw new Error("Invalid purchased resolution");
    }

    return resolutions.slice(0, purchasedIndex + 1);
}

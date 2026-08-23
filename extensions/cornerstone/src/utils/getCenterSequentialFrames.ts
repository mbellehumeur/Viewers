interface ImageIdToPrefetch {
  imageId: string;
  imageIdIndex: number;
}

/**
 * Prefetch order: middle frame first, then lower half descending to 0,
 * then upper half ascending to the end.
 */
export default function getCenterSequentialFrames(imageIds: string[]): ImageIdToPrefetch[] {
  if (imageIds.length <= 1) {
    return imageIds.map((imageId, imageIdIndex) => ({ imageId, imageIdIndex }));
  }

  const mid = Math.floor(imageIds.length / 2);
  const order: ImageIdToPrefetch[] = [{ imageId: imageIds[mid], imageIdIndex: mid }];

  for (let i = mid - 1; i >= 0; i--) {
    order.push({ imageId: imageIds[i], imageIdIndex: i });
  }

  for (let i = mid + 1; i < imageIds.length; i++) {
    order.push({ imageId: imageIds[i], imageIdIndex: i });
  }

  return order;
}

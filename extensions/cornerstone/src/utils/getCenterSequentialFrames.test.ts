import getCenterSequentialFrames from './getCenterSequentialFrames';

describe('getCenterSequentialFrames', () => {
  it('should return empty array when input is empty', () => {
    expect(getCenterSequentialFrames([])).toEqual([]);
  });

  it('should return single element when input has one element', () => {
    const imageIds = ['image-1'];
    const result = getCenterSequentialFrames(imageIds);

    expect(result).toEqual([{ imageId: 'image-1', imageIdIndex: 0 }]);
  });

  it('should return correct order for three elements', () => {
    const imageIds = ['image-1', 'image-2', 'image-3'];
    const result = getCenterSequentialFrames(imageIds);

    expect(result).toEqual([
      { imageId: 'image-2', imageIdIndex: 1 },
      { imageId: 'image-1', imageIdIndex: 0 },
      { imageId: 'image-3', imageIdIndex: 2 },
    ]);
  });

  it('should start with middle then lower half then upper half for odd length', () => {
    const imageIds = ['image-1', 'image-2', 'image-3', 'image-4', 'image-5'];
    const result = getCenterSequentialFrames(imageIds);

    expect(result).toEqual([
      { imageId: 'image-3', imageIdIndex: 2 },
      { imageId: 'image-2', imageIdIndex: 1 },
      { imageId: 'image-1', imageIdIndex: 0 },
      { imageId: 'image-4', imageIdIndex: 3 },
      { imageId: 'image-5', imageIdIndex: 4 },
    ]);
  });

  it('should start with middle then lower half then upper half for even length', () => {
    const imageIds = ['image-1', 'image-2', 'image-3', 'image-4', 'image-5', 'image-6'];
    const result = getCenterSequentialFrames(imageIds);

    expect(result).toEqual([
      { imageId: 'image-4', imageIdIndex: 3 },
      { imageId: 'image-3', imageIdIndex: 2 },
      { imageId: 'image-2', imageIdIndex: 1 },
      { imageId: 'image-1', imageIdIndex: 0 },
      { imageId: 'image-5', imageIdIndex: 4 },
      { imageId: 'image-6', imageIdIndex: 5 },
    ]);
  });

  it('should handle large array correctly', () => {
    const imageIds = Array.from({ length: 10 }, (_, i) => `image-${i + 1}`);
    const result = getCenterSequentialFrames(imageIds);

    expect(result).toHaveLength(10);
    expect(result[0]).toEqual({ imageId: 'image-6', imageIdIndex: 5 });
    expect(result.map(r => r.imageIdIndex)).toEqual([5, 4, 3, 2, 1, 0, 6, 7, 8, 9]);
  });

  it('should handle duplicate imageIds with different indices', () => {
    const imageIds = ['duplicate', 'unique', 'duplicate'];
    const result = getCenterSequentialFrames(imageIds);

    expect(result).toEqual([
      { imageId: 'unique', imageIdIndex: 1 },
      { imageId: 'duplicate', imageIdIndex: 0 },
      { imageId: 'duplicate', imageIdIndex: 2 },
    ]);
  });
});

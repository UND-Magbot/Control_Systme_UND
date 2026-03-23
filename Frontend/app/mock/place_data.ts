export interface PlaceItem {
  id: number;
  name: string;
  checked: boolean;
}

export const mockPlaces: PlaceItem[] = Array.from({ length: 30 }, (_, idx) => ({
  id: idx + 1,
  name: `장소명 ${idx + 1}`,
  checked: false,
}));
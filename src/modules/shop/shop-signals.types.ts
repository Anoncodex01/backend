export type ShopProductSignal = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
};

export type UserShopSignals = {
  viewed: ShopProductSignal[];
  cart: ShopProductSignal[];
  purchased: ShopProductSignal[];
  liked: ShopProductSignal[];
};

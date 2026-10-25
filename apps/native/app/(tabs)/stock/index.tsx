import { BilletStock } from "@/features/foundry/billet-stock";
import { StockView } from "@/features/stock/stock-view";

export default function StockScreen() {
  return <StockView top={<BilletStock />} />;
}

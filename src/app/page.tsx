import { PlanningApp } from "@/components/planning-app";
import { getPlanningData } from "@/lib/planning-data";

export default async function Home() {
  const { data, source } = await getPlanningData();
  return <PlanningApp initialData={data} source={source} />;
}

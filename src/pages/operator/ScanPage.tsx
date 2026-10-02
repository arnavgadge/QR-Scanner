import { ScanWorkflow } from '../../features/operator';

export default function ScanPage() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-4 text-2xl font-bold sm:text-3xl">
        Scan serial
      </h1>
      <ScanWorkflow />
    </section>
  );
}

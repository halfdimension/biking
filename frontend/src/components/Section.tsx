/**
 * A labeled section shell used to lay out sidebar containers.
 *
 * In this task (12.1) these are placeholder shells; the real inputs and lists
 * land in later tasks (13/14/26). The label makes the layout real and testable.
 */
import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  children?: ReactNode;
}

export default function Section({ title, children }: SectionProps) {
  return (
    <section className="section">
      <h3 className="section__title">{title}</h3>
      <div className="section__body">
        {children ?? <span>Coming soon</span>}
      </div>
    </section>
  );
}

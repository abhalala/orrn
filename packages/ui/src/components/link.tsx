import {
  createContext,
  forwardRef,
  useContext,
  type AnchorHTMLAttributes,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";

/**
 * Router-agnostic link for the component library. `@orrn/ui` doesn't depend
 * on a router; the app passes its router's link once with `<LinkProvider>`
 * (web: TanStack `Link`, so navigation never full-reloads). Without a provider
 * it renders a plain `<a href>`.
 */
export type UiLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  children?: ReactNode;
};

export type LinkComponent = ForwardRefExoticComponent<UiLinkProps & RefAttributes<HTMLAnchorElement>>;

const PlainLink: LinkComponent = forwardRef<HTMLAnchorElement, UiLinkProps>(function PlainLink(
  { to, ...rest },
  ref,
) {
  return <a ref={ref} href={to} {...rest} />;
});

const LinkContext = createContext<LinkComponent>(PlainLink);

export function LinkProvider({ component, children }: { component: LinkComponent; children?: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

export const UiLink = forwardRef<HTMLAnchorElement, UiLinkProps>(function UiLink(props, ref) {
  const Component = useContext(LinkContext);
  return <Component ref={ref} {...props} />;
});

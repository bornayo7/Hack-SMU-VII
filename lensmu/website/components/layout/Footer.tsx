import { BrandLogo } from "@/components/layout/BrandLogo";
import { contactLinks, githubLinks, linkedinLinks, navLinks } from "@/data/site";

export function Footer() {
  return (
    <footer className="bg-neutral-950 text-white">
      <div className="section-shell py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.9fr_0.9fr]">
          <div>
            <BrandLogo inverse className="mb-4" />
            <p className="max-w-md text-sm leading-6 text-white/70">
              Translate text inside image-heavy webpages, from manga panels and
              screenshots to menus, signs, infographics, and scanned pages.
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">Explore</h3>
            <div className="grid gap-3">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">Connect</h3>
            <div className="grid gap-3">
              {contactLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">GitHub</h3>
            <div className="grid gap-3">
              {githubLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">LinkedIn</h3>
            <div className="grid gap-3">
              {linkedinLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-sm text-white/60">
          Built for hackathon demos, product showcases, and the next generation
          of visual translation tools.
        </div>
      </div>
    </footer>
  );
}

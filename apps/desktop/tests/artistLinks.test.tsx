import { fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ArtistLinks } from "../src/components/entity/ArtistLinks";

function ArtistTarget() {
  const location = useLocation();
  const { uri } = useParams();

  return (
    <output>
      {decodeURIComponent(uri ?? "")}
      {":"}
      {(location.state as { name?: string } | null)?.name}
    </output>
  );
}

function SearchTarget() {
  const location = useLocation();

  return <output>{location.search}</output>;
}

describe("ArtistLinks", () => {
  it("navigates internally with summary state for an artist URI", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <ArtistLinks
                creators={[
                  {
                    name: "OC",
                    uri: "spotify:artist:oc",
                  },
                ]}
              />
            }
          />
          <Route path="/artist/:uri" element={<ArtistTarget />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "OC" }));

    expect(screen.getByText("spotify:artist:oc:OC")).toBeVisible();
  });

  it("sends artists without a URI to the filtered internal search", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <ArtistLinks creators={[{ name: "madein2k" }]} />
            }
          />
          <Route path="/search" element={<SearchTarget />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("link", { name: "madein2k" }),
    );

    expect(screen.getByText("?q=madein2k&type=artists")).toBeVisible();
  });

  it("keeps order and separators of several artists", () => {
    render(
      <MemoryRouter>
        <ArtistLinks
          creators={[
            { name: "OC", uri: "mock:artist:oc" },
            { name: "madein2k" },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("OC").parentElement).toHaveTextContent(
      "OC, madein2k",
    );
  });
});

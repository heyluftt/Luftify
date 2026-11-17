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
  it("navigiert bei einer Artist-URI intern mit Summary-State", () => {
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

  it("führt Artists ohne URI in die gefilterte interne Suche", () => {
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

  it("bewahrt Reihenfolge und Trennung mehrerer Artists", () => {
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

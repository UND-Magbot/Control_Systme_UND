import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FilterSelectBox, { type FilterOption } from "@/app/components/button/FilterSelectBox";

afterEach(cleanup);

const robots: FilterOption[] = [
  { id: "R-001", label: "R-001" },
  { id: "R-002", label: "R-002" },
];

/** 트리거(닫힌 상태)에 보이는 문구 */
const triggerText = (index = 0) =>
  document.querySelectorAll("span")[index]?.textContent;

describe("FilterSelectBox 전체 상태 표시 (T-03)", () => {
  it("전체 상태에서 placeholder 를 유지한다 — 리터럴 '전체'로 덮지 않는다", () => {
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel={null}
        placeholder="전체 로봇"
        onSelect={() => {}}
      />
    );
    expect(triggerText()).toBe("전체 로봇");
  });

  it("드롭다운에서 전체를 고른 뒤에도 트리거가 placeholder 를 유지한다", () => {
    const onSelect = vi.fn();
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel={null}
        placeholder="전체 로봇"
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByText("전체 로봇"));   // 열기
    fireEvent.click(screen.getByText("전체"));        // 전체 선택

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(triggerText()).toBe("전체 로봇");
    expect(screen.queryByText("전체")).toBeNull();    // 드롭다운이 닫혔다
  });

  it("나란히 놓인 두 필터가 서로 다른 문구로 보인다", () => {
    render(
      <>
        <FilterSelectBox
          items={[{ id: "charging", label: "충전중" }]}
          selectedLabel={null}
          placeholder="상태"
          onSelect={() => {}}
        />
        <FilterSelectBox
          items={[{ id: "on", label: "켜짐" }]}
          selectedLabel={null}
          placeholder="전원"
          onSelect={() => {}}
        />
      </>
    );
    const texts = Array.from(document.querySelectorAll("span")).map((s) => s.textContent);
    expect(texts).toContain("상태");
    expect(texts).toContain("전원");
  });

  it("selectedLabel 로 '전체' 문자열이 들어와도 placeholder 를 보여준다", () => {
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel="전체"
        placeholder="전체 결과"
        onSelect={() => {}}
      />
    );
    expect(triggerText()).toBe("전체 결과");
  });
});

describe("FilterSelectBox allLabel", () => {
  it("allLabel 을 주면 트리거와 드롭다운 첫 항목이 모두 그 문구를 쓴다", () => {
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel={null}
        placeholder="로봇명"
        allLabel="전체 로봇"
        onSelect={() => {}}
      />
    );
    expect(triggerText()).toBe("전체 로봇");

    fireEvent.click(screen.getByText("전체 로봇"));
    expect(screen.queryByText("전체")).toBeNull();
    // 트리거 + 드롭다운 첫 항목 2곳
    expect(screen.getAllByText("전체 로봇")).toHaveLength(2);
  });

  it("allLabel 이 없으면 드롭다운 첫 항목은 기존대로 '전체'", () => {
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel={null}
        placeholder="층"
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByText("층"));
    expect(screen.getByText("전체")).toBeTruthy();
  });
});

describe("FilterSelectBox 항목 선택", () => {
  it("항목을 고르면 그 라벨을 보여주고 onSelect 에 항목을 넘긴다", () => {
    const onSelect = vi.fn();
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel={null}
        placeholder="전체 로봇"
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByText("전체 로봇"));
    fireEvent.click(screen.getByText("R-002"));

    expect(onSelect).toHaveBeenCalledWith({ id: "R-002", label: "R-002" });
  });

  it("showTotal=false 면 전체 항목이 없다", () => {
    render(
      <FilterSelectBox
        items={robots}
        selectedLabel={null}
        placeholder="작업유형을 선택하세요"
        showTotal={false}
        onSelect={() => {}}
      />
    );
    fireEvent.click(screen.getByText("작업유형을 선택하세요"));
    expect(screen.queryByText("전체")).toBeNull();
  });
});

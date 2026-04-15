"use client";

import React, { useState, useEffect } from "react";
import styles from '../../DataManagementTabs.module.css';
import type { LogItem } from "@/app/types";
import { getLogData } from "@/app/lib/logData";
import LogList from "./LogList";
import { periodFormatDate } from "../../../utils/videoHelpers";

type Props = {
  initialSearch?: string;
  onLoaded?: () => void;
};

export default function LogTab({ initialSearch, onLoaded }: Props) {
  const [logData, setLogData] = useState<LogItem[]>([]);

  useEffect(() => {
    const today = periodFormatDate(new Date());
    getLogData({ start_date: today, end_date: today }).then((res) => {
      setLogData(res.items);
      onLoaded?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.DT}>
      <LogList logData={logData} initialSearch={initialSearch} />
    </div>
  );
}

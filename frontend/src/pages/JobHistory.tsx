import React, { useEffect, useState } from 'react';
import { apiClient, JobRecord, JobDetail } from '../api/client';
import { OutputFileList } from '../components/Progress/OutputFileList';

/**
 * JobHistory Component
 * 
 * Displays a list of all jobs at /history route, ordered newest first.
 * Each row shows job ID, status badge, submission time, action type.
 * Clicking a completed job row shows OutputFileList.
 * Clicking a failed job row shows CLI error code and message.
 * 
 * Validates: Requirements 9.2, 9.3, 9.4
 */

const JobHistory: React.FC = () => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetail>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

  // Fetch job list on mount
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setLoading(true);
        setError(null);
        const jobList = await apiClient.getJobs(100, 0); // Fetch first 100 jobs
        setJobs(jobList);
      } catch (err: unknown) {
        console.error('Failed to fetch jobs:', err);
        if (err && typeof err === 'object' && 'message' in err) {
          setError(err.message as string);
        } else {
          setError('Failed to fetch job history');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  /**
   * Format timestamp in human-readable format
   */
  const formatTimestamp = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  /**
   * Get status badge styling based on job status
   */
  const getStatusBadge = (status: string) => {
    const baseClasses = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    
    switch (status) {
      case 'completed':
        return {
          className: `${baseClasses} bg-green-900 bg-opacity-30 text-green-400 border border-green-500`,
          icon: (
            <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ),
          label: 'Completed',
        };
      case 'running':
        return {
          className: `${baseClasses} bg-blue-900 bg-opacity-30 text-blue-400 border border-blue-500`,
          icon: (
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400 mr-1"></div>
          ),
          label: 'Running',
        };
      case 'queued':
        return {
          className: `${baseClasses} bg-yellow-900 bg-opacity-30 text-yellow-400 border border-yellow-500`,
          icon: (
            <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          ),
          label: 'Queued',
        };
      case 'failed':
        return {
          className: `${baseClasses} bg-red-900 bg-opacity-30 text-red-400 border border-red-500`,
          icon: (
            <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          ),
          label: 'Failed',
        };
      case 'timed_out':
        return {
          className: `${baseClasses} bg-orange-900 bg-opacity-30 text-orange-400 border border-orange-500`,
          icon: (
            <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          ),
          label: 'Timed Out',
        };
      default:
        return {
          className: `${baseClasses} bg-gray-700 text-gray-400 border border-gray-600`,
          icon: null,
          label: status,
        };
    }
  };

  /**
   * Handle job row click - fetch details and expand/collapse
   */
  const handleJobClick = async (job: JobRecord) => {
    // If already expanded, collapse
    if (expandedJobId === job.job_id) {
      setExpandedJobId(null);
      return;
    }

    // Expand and fetch details if not already loaded
    setExpandedJobId(job.job_id);

    if (!jobDetails[job.job_id]) {
      setLoadingDetails((prev) => ({ ...prev, [job.job_id]: true }));
      try {
        const details = await apiClient.getJob(job.job_id);
        setJobDetails((prev) => ({ ...prev, [job.job_id]: details }));
      } catch (err) {
        console.error('Failed to fetch job details:', err);
      } finally {
        setLoadingDetails((prev) => ({ ...prev, [job.job_id]: false }));
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6 text-white">Job History</h2>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
          <span className="ml-3 text-gray-400">Loading job history...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6 text-white">Job History</h2>
        <div className="rounded-lg bg-red-900 bg-opacity-20 border border-red-500 px-4 py-4">
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-red-500 mr-3 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300">Error loading job history</p>
              <p className="mt-1 text-sm text-red-200">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (jobs.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6 text-white">Job History</h2>
        <div className="rounded-lg bg-gray-800 border border-gray-700 px-4 py-12">
          <div className="flex flex-col items-center justify-center text-gray-400">
            <svg
              className="h-16 w-16 text-gray-600 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-lg font-medium">No jobs yet</p>
            <p className="text-sm text-gray-500 mt-2">Submit a slicing job to see it here</p>
          </div>
        </div>
      </div>
    );
  }

  // Job list
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6 text-white">Job History</h2>
      
      <div className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 bg-gray-750">
          <p className="text-sm text-gray-400">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} total
          </p>
        </div>

        <div className="divide-y divide-gray-700">
          {jobs.map((job) => {
            const badge = getStatusBadge(job.status);
            const isExpanded = expandedJobId === job.job_id;
            const details = jobDetails[job.job_id];
            const isLoadingDetails = loadingDetails[job.job_id];

            return (
              <div key={job.job_id} className="transition-colors">
                {/* Job Row */}
                <button
                  onClick={() => handleJobClick(job)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-750 transition-colors text-left"
                >
                  <div className="flex items-center flex-1 min-w-0 mr-4 space-x-4">
                    {/* Job ID */}
                    <div className="min-w-0 flex-shrink-0">
                      <p className="text-xs text-gray-500 mb-1">Job ID</p>
                      <p className="text-sm font-mono text-gray-300 truncate" title={job.job_id}>
                        {job.job_id.slice(0, 8)}...
                      </p>
                    </div>

                    {/* Status Badge */}
                    <div className="flex-shrink-0">
                      <p className="text-xs text-gray-500 mb-1">Status</p>
                      <span className={badge.className}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    </div>

                    {/* Submission Time */}
                    <div className="flex-shrink-0">
                      <p className="text-xs text-gray-500 mb-1">Submitted</p>
                      <p className="text-sm text-gray-300" title={job.submitted_at}>
                        {formatTimestamp(job.submitted_at)}
                      </p>
                    </div>

                    {/* Action Type */}
                    <div className="flex-shrink-0">
                      <p className="text-xs text-gray-500 mb-1">Action</p>
                      <p className="text-sm text-gray-300 capitalize">
                        {job.action_type.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>

                  {/* Expand/Collapse Icon */}
                  <svg
                    className={`h-5 w-5 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 py-4 bg-gray-900 border-t border-gray-700">
                    {isLoadingDetails ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
                        <span className="ml-3 text-sm text-gray-400">Loading details...</span>
                      </div>
                    ) : details ? (
                      <div className="space-y-4">
                        {/* Full Job ID */}
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Full Job ID</p>
                          <p className="text-sm font-mono text-gray-300 break-all">{details.job_id}</p>
                        </div>

                        {/* Timestamps */}
                        <div className="grid grid-cols-3 gap-4">
                          {details.started_at && (
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Started</p>
                              <p className="text-sm text-gray-300">{formatTimestamp(details.started_at)}</p>
                            </div>
                          )}
                          {details.completed_at && (
                            <div>
                              <p className="text-xs text-gray-500 mb-1">Completed</p>
                              <p className="text-sm text-gray-300">{formatTimestamp(details.completed_at)}</p>
                            </div>
                          )}
                        </div>

                        {/* Completed Job - Show Output Files */}
                        {details.status === 'completed' && (
                          <div className="mt-4">
                            <OutputFileList jobId={details.job_id} />
                          </div>
                        )}

                        {/* Failed Job - Show Error */}
                        {details.status === 'failed' && (
                          <div className="mt-4 rounded-lg bg-red-900 bg-opacity-20 border border-red-500 px-4 py-4">
                            <div className="flex items-start">
                              <svg
                                className="h-5 w-5 text-red-500 mr-3 mt-0.5 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-red-300">
                                  CLI Error (Exit Code: {details.exit_code})
                                </p>
                                <p className="mt-2 text-sm text-red-200 font-mono whitespace-pre-wrap">
                                  {details.error_message || 'No error message available'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Timed Out Job - Show Timeout Message */}
                        {details.status === 'timed_out' && (
                          <div className="mt-4 rounded-lg bg-orange-900 bg-opacity-20 border border-orange-500 px-4 py-4">
                            <div className="flex items-start">
                              <svg
                                className="h-5 w-5 text-orange-500 mr-3 mt-0.5 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-orange-300">Job Timed Out</p>
                                <p className="mt-2 text-sm text-orange-200">
                                  This job exceeded the maximum execution time and was terminated.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-gray-400">
                        <p className="text-sm">Failed to load job details</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default JobHistory;

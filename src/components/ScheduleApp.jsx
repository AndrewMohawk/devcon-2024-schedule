import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Calendar, Bookmark, ExternalLink, X, RefreshCw, ArrowDown } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "../components/ui/AlertDialog";

// Helper to create a search index
const createSearchIndex = (sessions) => {
  return sessions.map(session => ({
    ...session,
    searchText: (
      session.title.toLowerCase() + ' ' +
      session.description.toLowerCase() + ' ' +
      (session.track || '').toLowerCase() + ' ' +
      (session.speakers || []).map(s => s.name.toLowerCase()).join(' ')
    )
  }));
};

const NOW_MARKER_ID = 'current-time-marker';

const SessionCard = React.memo(({ 
  session, 
  showTimeline, 
  onToggleBookmark, 
  isBookmarked,
  onRoomClick,
  onTrackClick 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const startTime = new Date(session.slot_start);
  const endTime = new Date(session.slot_end);
  const currentTime = new Date();
  const isCurrentSession = startTime <= currentTime && endTime >= currentTime;

  return (
    <div className="relative">
      {showTimeline && isCurrentSession && (
        <div id={NOW_MARKER_ID} className="absolute -left-4 right-0 h-0.5 bg-red-500 z-10" style={{ top: '50%' }} />
      )}
      <div className={`border rounded-lg p-4 mb-4 bg-white shadow-sm hover:shadow-md transition-shadow ${
        isCurrentSession ? 'border-red-500' : ''
      }`}>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{session.title}</h3>
            <div className="text-sm text-gray-600 mt-1">
              {startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - {
                endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} | 
              <button 
                onClick={() => onRoomClick(session.slot_room?.name)}
                className="ml-1 text-blue-600 hover:underline"
              >
                Room: {session.slot_room?.name}
              </button>
            </div>
            {session.track && (
              <button
                onClick={() => onTrackClick(session.track)}
                className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded mt-2 hover:bg-blue-200"
              >
                {session.track}
              </button>
            )}
          </div>
          <button
            onClick={() => onToggleBookmark(session.id)}
            className={`p-2 rounded-full ${isBookmarked ? 'text-yellow-500' : 'text-gray-400'}`}
          >
            <Bookmark className={`w-5 h-5 ${isBookmarked ? 'fill-current' : ''}`} />
          </button>
        </div>
        
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full text-left mt-2"
        >
          <p className={`text-sm text-gray-600 ${isExpanded ? '' : 'line-clamp-2'}`}>
            {session.description}
          </p>
          {session.description.length > 100 && (
            <span className="text-xs text-blue-600 hover:text-blue-800 mt-1">
              {isExpanded ? 'Show less' : 'Show more'}
            </span>
          )}
        </button>
        
        {session.speakers && session.speakers.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {session.speakers.map(speaker => (
                <div key={speaker.id} className="flex items-center space-x-2">
                  {speaker.avatar && (
                    <img 
                      src={speaker.avatar} 
                      alt={speaker.name}
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <span className="text-sm font-medium">{speaker.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(session.resources_presentation || session.resources_slides) && (
          <div className="mt-3 flex gap-2">
            {session.resources_presentation && (
              <a
                href={session.resources_presentation}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <ExternalLink className="w-4 h-4" />
                Presentation
              </a>
            )}
            {session.resources_slides && (
              <a
                href={session.resources_slides}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <ExternalLink className="w-4 h-4" />
                Slides
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const ScheduleApp = () => {
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [searchIndex, setSearchIndex] = useState([]);
  const [bookmarkedSessions, setBookmarkedSessions] = useState(() => {
    try {
      const stored = localStorage.getItem('devcon-bookmarked-sessions');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedTrack, setSelectedTrack] = useState('all');
  const [selectedRoom, setSelectedRoom] = useState('all');
  const [view, setView] = useState('schedule');
  const searchInputRef = useRef(null);
  const searchTimeout = useRef(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [updateStats, setUpdateStats] = useState({ added: 0, modified: 0, unchanged: 0 });

  // Load initial data
  const fetchData = async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    else setIsLoading(true);
    
    try {
      const response = await fetch('https://corsproxy.io/?https://api.devcon.org/sessions?sort=slot_start&order=asc&event=devcon-7&size=1000');
      const data = await response.json();
      const newSessions = data.data.items;
      
      // Compare with existing sessions to detect changes
      const stats = {
        added: 0,
        modified: 0,
        unchanged: 0
      };
  
      if (sessions.length > 0) {
        const existingIds = new Set(sessions.map(s => s.id));
        
        newSessions.forEach(session => {
          const existingSession = sessions.find(s => s.id === session.id);
          if (!existingSession) {
            stats.added++;
          } else if (JSON.stringify(existingSession) !== JSON.stringify(session)) {
            stats.modified++;
          } else {
            stats.unchanged++;
          }
        });
  
        setUpdateStats(stats);
        setIsUpdateDialogOpen(true);
      }
  
      setSessions(newSessions);
      setFilteredSessions(newSessions);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Create search index when sessions load
  useEffect(() => {
    setSearchIndex(createSearchIndex(sessions));
  }, [sessions]);

  // Save bookmarks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('devcon-bookmarked-sessions', JSON.stringify(bookmarkedSessions));
    } catch (error) {
      console.error('Failed to save bookmarks:', error);
    }
  }, [bookmarkedSessions]);

  // Scroll to current time
  const scrollToNow = useCallback(() => {
    const marker = document.getElementById(NOW_MARKER_ID);
    if (marker) {
      marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // Memoize unique tracks, rooms, and days
  const { tracks, rooms, days } = useMemo(() => {
    const trackSet = new Set(sessions.map(session => session.track).filter(Boolean));
    const roomSet = new Set(sessions.map(session => session.slot_room?.name).filter(Boolean));
    const daySet = new Set(sessions.map(session => 
      new Date(session.slot_start).toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      })
    ));

    return {
      tracks: Array.from(trackSet).sort(),
      rooms: Array.from(roomSet).sort(),
      days: Array.from(daySet).sort((a, b) => new Date(a) - new Date(b))
    };
  }, [sessions]);

  // Optimized filter function
  const filterSessions = useCallback(() => {
    // Start with the indexed sessions
    let filtered = searchIndex;

    // Apply search filter first using the index
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(session => 
        session.searchText.includes(searchLower)
      );
    }

    // Then apply other filters
    if (selectedDay !== 'all') {
      filtered = filtered.filter(session => 
        new Date(session.slot_start).toLocaleDateString('en-US', { 
          weekday: 'long', 
          month: 'short', 
          day: 'numeric' 
        }) === selectedDay
      );
    }

    if (selectedTrack !== 'all') {
      filtered = filtered.filter(session => session.track === selectedTrack);
    }

    if (selectedRoom !== 'all') {
      filtered = filtered.filter(session => session.slot_room?.name === selectedRoom);
    }

    setFilteredSessions(filtered);
  }, [searchTerm, selectedDay, selectedTrack, selectedRoom, searchIndex]);

  // Apply filters when any filter changes
  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }
    searchTimeout.current = setTimeout(filterSessions, 100);
    return () => clearTimeout(searchTimeout.current);
  }, [filterSessions]);

  // Reset filters
  const resetFilters = () => {
    setSearchTerm('');
    setSelectedDay('all');
    setSelectedTrack('all');
    setSelectedRoom('all');
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // Toggle bookmark
  const toggleBookmark = useCallback((sessionId) => {
    setBookmarkedSessions(prev => {
      if (prev.includes(sessionId)) {
        return prev.filter(id => id !== sessionId);
      }
      return [...prev, sessionId];
    });
  }, []);

  // Handle filter clicks
  const handleRoomClick = useCallback((room) => {
    setSelectedRoom(room);
    setView('schedule');
  }, []);

  const handleTrackClick = useCallback((track) => {
    setSelectedTrack(track);
    setView('schedule');
  }, []);

  // Group sessions by day with current time marker
  const groupedSessions = useMemo(() => {
    const grouped = {};
    const currentTime = new Date();
    let hasCurrentSession = false;
    
    const sessionsToGroup = view === 'schedule' ? filteredSessions : 
      sessions.filter(session => bookmarkedSessions.includes(session.id));

    sessionsToGroup.forEach(session => {
      const startTime = new Date(session.slot_start);
      const endTime = new Date(session.slot_end);
      const isCurrentSession = startTime <= currentTime && endTime >= currentTime;
      if (isCurrentSession) hasCurrentSession = true;

      const day = startTime.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      });
      
      if (!grouped[day]) {
        grouped[day] = [];
      }
      grouped[day].push(session);
    });

    // Sort sessions within each day
    Object.keys(grouped).forEach(day => {
      grouped[day].sort((a, b) => new Date(a.slot_start) - new Date(b.slot_start));
    });

    return { grouped, hasCurrentSession };
  }, [filteredSessions, sessions, bookmarkedSessions, view]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fixed top bar */}
      <div className="fixed top-0 left-0 right-0 bg-white border-b z-50 px-4 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-gray-900">Devcon Schedule</h1>
          
          <div className="flex items-center gap-2">
            {groupedSessions.hasCurrentSession && (
              <button
                onClick={scrollToNow}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
              >
                <ArrowDown className="w-4 h-4" />
                Current
              </button>
            )}
            
            <button
              onClick={() => setView('schedule')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-sm ${
                view === 'schedule' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Schedule</span>
            </button>
            
            <button
              onClick={() => setView('bookmarks')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-sm ${
                view === 'bookmarks' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              <Bookmark className="w-4 h-4" />
              <span className="hidden sm:inline">My Schedule</span>
            </button>

            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 ${
                isRefreshing ? 'opacity-50' : ''
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 pt-16">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            {/* Filters */}
            {view === 'schedule' && (
              <div className="sticky top-16 bg-gray-50 pt-4 pb-2 z-40">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search sessions..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 text-sm border rounded-lg"
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  <select
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="all">All Days</option>
                    {days.map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  
                  <select
                    value={selectedTrack}
                    onChange={(e) => setSelectedTrack(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="all">All Tracks</option>
                    {tracks.map(track => (
                      <option key={track} value={track}>{track}</option>
                    ))}
                  </select>

                  <select
                    value={selectedRoom}
                    onChange={(e) => setSelectedRoom(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="all">All Rooms</option>
                    {rooms.map(room => (
                      <option key={room} value={room}>{room}</option>
                    ))}
                  </select>
                </div>

                {(searchTerm || selectedDay !== 'all' || selectedTrack !== 'all' || selectedRoom !== 'all') && (
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={resetFilters}
                      className="flex items-center gap-1 px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                    >
                      <X className="w-4 h-4" />
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Session Lists */}
            <div className="space-y-6 mt-4">
              {Object.entries(groupedSessions.grouped).map(([day, daySessions]) => (
                <div key={day}>
                  <h2 className="text-xl font-semibold mb-4">{day}</h2>
                  {daySessions.map(session => (
                    <SessionCard 
                      key={session.id} 
                      session={session} 
                      showTimeline={view === 'bookmarks'}
                      isBookmarked={bookmarkedSessions.includes(session.id)}
                      onToggleBookmark={toggleBookmark}
                      onRoomClick={handleRoomClick}
                      onTrackClick={handleTrackClick}
                    />
                  ))}
                </div>
              ))}

              {Object.keys(groupedSessions.grouped).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No sessions found
                </div>
              )}
            </div>
          </>
        )}
      </div>
    {/* Update Dialog */}
<AlertDialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Schedule Updated</AlertDialogTitle>
      <AlertDialogDescription>
        {updateStats.added > 0 && (
          <div className="text-green-600">• {updateStats.added} new sessions added</div>
        )}
        {updateStats.modified > 0 && (
          <div className="text-blue-600">• {updateStats.modified} sessions modified</div>
        )}
        {updateStats.unchanged > 0 && (
          <div className="text-gray-600">• {updateStats.unchanged} sessions unchanged</div>
        )}
        {updateStats.added === 0 && updateStats.modified === 0 && (
          <div className="text-gray-600">No changes found in the schedule</div>
        )}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogAction onClick={() => setIsUpdateDialogOpen(false)}>
        Okay
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
    </div>
  );
};

export default ScheduleApp;
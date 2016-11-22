/*jshint esversion: 6*/

import Composer from 'discourse/models/composer';
import { withPluginApi } from 'discourse/lib/plugin-api';
import computed from 'ember-addons/ember-computed-decorators';
import NavigationItem from 'discourse/components/navigation-item';
import CategoryDrop from 'discourse/components/category-drop';
import DiscoveryTopicsController from 'discourse/controllers/discovery/topics';
import TopicTrackingState from 'discourse/models/topic-tracking-state';
import { on } from 'ember-addons/ember-computed-decorators';
import ComposerEditor from 'discourse/components/composer-editor';
import DiscoveryTopics from 'discourse/controllers/discovery/topics';
import TopicView from 'discourse/views/topic';
import TopicModel from 'discourse/models/topic';
import TopicController from 'discourse/controllers/topic';
import TopicRouter from 'discourse/routes/topic';
import TopicFromParamsRouter from 'discourse/routes/topic-from-params';
import MountWidget from 'discourse/components/mount-widget';
import { NotificationLevels } from 'discourse/lib/notification-levels';
import { h } from 'virtual-dom';
import RawHtml from 'discourse/widgets/raw-html';
import { dateNode } from 'discourse/helpers/node';
import FullPageSearchController from 'discourse/controllers/full-page-search';
import SiteHeader from 'discourse/components/site-header';

// startsWith polyfill from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}

export default {
    name: 'extend-for-projects',
    initialize() {
        function getProjectModel() {
            var projectModel = {};
            var container = Discourse.__container__;
            var route = container.lookup('controller:Application').currentPath;
            projectModel.route = route;

            if (route.startsWith('topic')) {
                var topicController = container.lookup('controller:topic');
                var topicModel = topicController.model;
                if (topicModel.parent_names) {
                    projectModel.parent_names = topicModel.parent_names;
                    projectModel.parent_guids = topicModel.parent_guids;
                    projectModel.contributors = topicModel.contributors;
                    projectModel.project_is_public = topicModel.project_is_public;
                    projectModel.view_only = topicController.view_only;
                    return projectModel;
                }
            } else if (route.startsWith('projects.show') || route.startsWith('projects.top')) {
                var projectController = container.lookup('controller:projects.show');
                var projectList = projectController.list;
                if (projectList && projectList.topic_list.parent_names) {
                    var projectTopicList = projectList.topic_list;
                    projectModel.parent_names = projectTopicList.parent_names;
                    projectModel.parent_guids = projectTopicList.parent_guids;
                    projectModel.contributors = projectTopicList.contributors;
                    projectModel.project_is_public = projectTopicList.project_is_public;
                    projectModel.view_only = projectController.view_only;
                }
                var topicsModel = container.lookup('controller:discovery.topics').model;
                if (topicsModel) {
                    projectModel.navMode = topicsModel.navMode;
                }
                return projectModel;
            }
            return null;
        }

        // Setting this value is what makes new topics (from the composer) able to appear in the target project
        Composer.serializeOnCreate('parent_guids');

        // Allow the full-page-search-category connector to add the view_only link itself
        // Since it is an ember link-to, just modifying the link afterward would not be enough
        FullPageSearchController.reopen({
            view_only: function() {
                var viewOnlyMatch = this.get('q').match(/view_only:([a-zA-Z0-9]+)/);
                return viewOnlyMatch ? viewOnlyMatch[1] : null;
            }.property('q')
        });

        function fixSearchUrls() {
            var container = Discourse.__container__;
            var route = container.lookup('controller:Application').currentPath;

            if (!route.startsWith('full-page-search')) {
                return;
            }
            // All we can really reliably get is the view_only key and project_guid
            // But the guid by itself would not be very useful...
            var searchController = container.lookup('controller:full-page-search');
            var view_only = searchController.get('view_only');
            var queryString = view_only ? '?view_only=' + view_only : '';

            var topics = document.querySelectorAll('.topic');
            _.each(topics, t => {
                var projectLink = t.querySelector('.osf-search-parent-project a');
                var projectGuid = projectLink.href.match(/forum\/([a-zA-Z0-9]+)/)[1];

                var categoryLink = t.querySelector('.search-category a');
                if (!categoryLink.pathname.startsWith('/forum/')) {
                    categoryLink.pathname = '/forum/' + projectGuid + categoryLink.pathname;
                    categoryLink.search = queryString;
                }

                var topicLink = t.querySelector('a.search-link');
                topicLink.search = queryString;
            });
        }

        function fixUrls() {
            fixSearchUrls();

            var projectModel = getProjectModel();
            if (!projectModel) {
                return;
            }
            var projectGuid = projectModel.parent_guids[0];
            var navMode = projectModel.navMode;
            var viewOnly = projectModel.view_only;
            var route = projectModel.route;
            var queryString = projectModel.view_only ? '?view_only=' + projectModel.view_only : '';

            if (projectGuid) {
                var categoryLinks = document.querySelectorAll('.cat a, a.bullet');
                _.each(categoryLinks, link => {
                    if (!link.pathname.startsWith('/forum/')) {
                        link.pathname = '/forum/' + projectGuid + link.pathname;
                        link.search = queryString;
                    }
                });

                var footerLinks = document.querySelectorAll('h3 a');
                _.each(footerLinks, link => {
                    // normal non-ember-created links
                    if (link.id === '') {
                        if (link.pathname == '/latest') {
                            link.pathname = '/forum/' + projectGuid + link.pathname;
                            link.search = queryString;
                        }
                        return;
                    }
                    // These links were made by the link-to helper so they need to be modified
                    // in the ember View. This seems kinda convoluted...
                    var view = Ember.View.views[link.id];
                    var href = view.get('href');
                    if (href == '/' || href == '/latest') {
                        view.set('href', '/forum/' + projectGuid + queryString); // for appearance
                        view.set('loadedParams.targetRouteName', 'projects.show');
                        view.set('loadedParams.models', [projectGuid]);
                    } else if (href == '/categories') {
                        view.set('href', '/forum/' + projectGuid + '/' + navMode + queryString);
                        if (navMode.startsWith('top')) {
                            view.set('loadedParams.targetRouteName', 'projects.' + navMode);
                        } else {
                            view.set('loadedParams.targetRouteName', 'projects.show' + navMode.capitalize());
                        }
                        view.set('loadedParams.models', [projectGuid]);
                    }
                    view.set('loadedParams.queryParams', {view_only: viewOnly});
                });

                // Add the view_only id to all topics on the list
                if (queryString && (route.startsWith('projects.show') || route.startsWith('projects.top'))) {
                    var topicTitleLinks = document.querySelectorAll('.main-link a');
                    _.each(topicTitleLinks, link => {
                        link.search = queryString;
                    });
                }
            }

            // add view_only to topic search results
            if (viewOnly) {
                var searchLinks = document.querySelectorAll('ul:first-child a.search-link');
                _.each(searchLinks, link => {
                    link.search = queryString;
                });
            }

            // Remove sharing links on the dates from view_only views
            if (route.startsWith('topic') && viewOnly) {
                var postDateLinks = document.querySelectorAll('a.post-date');
                _.each(postDateLinks, el => {
                    var parentNode = el.parentNode;
                    var childNode = el.children[0];
                    parentNode.removeChild(el);
                    parentNode.appendChild(childNode);
                });
            }
        }

        // Use topic list information to add details to preloaded states
        function updateTopicTracking() {
            var container = Discourse.__container__;
            var route = container.lookup('controller:Application').currentPath;

            if (route.startsWith('projects.show') || route.startsWith('projects.top') || route.startsWith('discovery')) {
                var topicsController = container.lookup('controller:discovery.topics');
                var topicTrackingState = topicsController.topicTrackingState;
                var topics = topicsController.model.topic_list.topics;
                _.each(topics, t => {
                    var state = topicTrackingState.states['t' + t.id];
                    if (state) {
                        state.project_guid = t.project_guid;
                        state.project_is_public = t.project_is_public;
                    }
                });

                // Change the message count so that things that call countNew and countUnread will have to refresh
                topicTrackingState.set("messageCount", topicTrackingState.get("messageCount") + 1);
                topicTrackingState.set("messageCount", topicTrackingState.get("messageCount") - 1);
            }
        }

        withPluginApi('0.1', api => {
            api.onPageChange((url, title) => {
                Ember.run.scheduleOnce('afterRender', fixUrls);
                Ember.run.scheduleOnce('actions', updateTopicTracking);
            });

            // copied/exposed from search-menu-results
            function postResult(result, link, term) {
              const html = [link];

              if (!this.site.mobileView) {
                html.push(h('span.blurb', [ dateNode(result.created_at),
                                            ' - ',
                                            new Highlighted(result.blurb, term) ]));
              }

              return html;
            }

            // copied/exposed from search-menu-results
            class Highlighted extends RawHtml {
              constructor(html, term) {
                super({ html: `<span>${html}</span>` });
                this.term = term;
              }

              decorate($html) {
                if (this.term) {
                  $html.highlight(this.term.split(/\s+/), { className: 'search-highlight' });
                }
              }
            }

            // Override this widget to display project name
            // copied and changed from search-menu-results
            api.createWidget(`search-result-topic`, {
                html(attrs) {
                    return attrs.results.map(r => {
                        return h('li', this.attach('link', {
                            href: r.get('url'),
                            contents: () => {
                                const topic = r.topic;
                                const link = h('span.topic', [
                                  this.attach('topic-status', { topic, disableActions: true }),
                                  h('span.topic-title', new Highlighted(topic.get('fancyTitle'), attrs.term)),
                                  this.attach('category-link', { category: topic.get('category'), link: false })
                                ]);

                                let withProject = [link];
                                if (topic.project_guid) {
                                     withProject.push(h('div.osf-search-menu-parent-project', h('span', topic.project_name)));
                                }

                                return postResult.call(this, r, withProject, attrs.term);
                            },
                            className: 'search-link'
                        }));
                    });
                }
            });

            // Override this widget to add a project filter to the search term
            // copied and modified from discourse/widgets/search-menu-controls
            api.createWidget('search-term', {
                tagName: 'input',
                buildId: () => 'search-term',

                buildAttributes(attrs) {
                    let val = attrs.value || '';
                    let projectModel = getProjectModel();
                    if (projectModel) {
                        val = val.replace(' project:' + projectModel.parent_guids[0], '');
                        val = val.replace(' view_only:' + projectModel.view_only, '');
                    }

                    return { type: 'text',
                             value: val,
                             placeholder: attrs.contextEnabled ? "" : I18n.t('search.title') };
                 },

                 keyUp(e) {
                     if (e.which === 13) {
                         return this.sendWidgetAction('fullSearch');
                     }

                     const val = this.attrs.value;
                     let newVal = $(`#${this.buildId()}`).val();

                     let projectModel = getProjectModel();
                     if (projectModel) {
                         newVal += ' project:' + projectModel.parent_guids[0];
                         newVal += projectModel.view_only ? ' view_only:' + projectModel.view_only : '';
                     }

                     if (newVal !== val) {
                         this.sendWidgetAction('searchTermChanged', newVal);
                     }
                 }
            });
        });

        // To fix search result urls
        SiteHeader.reopen({
            afterRender() {
                this._super();
                Ember.run.scheduleOnce('afterRender', fixUrls);
            }
        });

        TopicView.reopen({
            domChange: function() {
                Ember.run.scheduleOnce('afterRender', fixUrls);
            }.on('didInsertElement')
        });

        TopicModel.reopen({
            updateFromJson(json) {
                this._super(json);
                Ember.run.scheduleOnce('afterRender', fixUrls);
            },

            // We have to add the view_only parameter to all of these urls...
            baseUrl: function() {
                let slug = this.get('slug') || '';
                if (slug.trim().length === 0) {
                    slug = "topic";
                }
                return Discourse.getURL("/t/") + slug + "/" + (this.get('id'));
            }.property('id', 'slug'),

            url: function() {
                var url = this.get('baseUrl');
                var view_only = this.get('view_only');
                return url + (view_only ? '?view_only=' + view_only : '');
            }.property('baseUrl', 'view_only'),

            urlForPostNumber(postNumber) {
                let url = this.get('baseUrl');
                if (postNumber && (postNumber > 0)) {
                    url += "/" + postNumber;
                }
                var view_only = this.get('view_only');
                return url + (view_only ? '?view_only=' + view_only : '');
            },

            summaryUrl: function () {
                var url = this.urlForPostNumber(1);
                var has_summary = this.get('has_summary');
                var view_only = this.get('view_only');
                url += has_summary || view_only ? '?' : '';
                url += has_summary ? 'filter=summary' : '';
                url += has_summary && view_only ? '&' : '';
                url += view_only ? 'view_only=' + view_only : '';
                return url;
            }.property('url')
        });

        // After "mounting"/rendering of the topic/poststream "widget"
        MountWidget.reopen({
            afterRender() {
                this._super();
                fixUrls();
            }
        });

        CategoryDrop.reopen({
            actions: {
                expand: function() {
                    this._super();
                    Ember.run.scheduleOnce('afterRender', fixUrls);
                },
            },
        });

        DiscoveryTopics.reopen({
            actions: {
                // This schedules a rerender, so we need to also schedule
                // DOM updating
                toggleBulkSelect() {
                    this._super();
                    Ember.run.scheduleOnce('afterRender', fixUrls);
                },
            }
        });

        // Make the navigation (latest, new, unread) buttons
        // more robust in determining if they are active since our routes/filterModes
        // will start with /forum/:project_guid
        NavigationItem.reopen({
            @computed("content.filterMode", "filterMode")
            active(contentFilterMode, filterMode) {
              return contentFilterMode === filterMode ||
                     contentFilterMode.indexOf(filterMode) !== -1;
            },
        });

        // Make the extraction of the navigation mode more robust by better checking
        // both navMode and filter in each of these functions
        DiscoveryTopicsController.reopen({
            showMoreUrl(period) {
                let url = '';
                if (this.get('model.filter').startsWith('forum')) {
                    url = '/forum/' + this.get('model.topic_list').parent_guids[0];
                }
                let category = this.get('category');
                if (category) {
                    url += '/c/' + Discourse.Category.slugFor(category) + (this.get('noSubcategories') ? '/none' : '') + '/l';
                }
                url += '/top/' + period;
                let viewOnly = this.get('view_only');
                url += viewOnly ? '?view_only=' + viewOnly : '';
                return url;
            },

            footerMessage: function() {
                if (!this.get('allLoaded')) { return; }

                const category = this.get('category');
                if (category) {
                    return I18n.t('topics.bottom.category', { category: category.get('name') });
                } else {
                    const mode = (this.get('model.navMode') || this.get('model.filter') || '').split('/').pop();
                    if (this.get('model.topics.length') === 0) {
                        return I18n.t("topics.none." + mode);
                    } else {
                        return I18n.t("topics.bottom." + mode);
                    }
                }
            }.property('allLoaded', 'model.topics.length'),

            footerEducation: function() {
                if (!this.get('allLoaded') || this.get('model.topics.length') > 0 || !Discourse.User.current()) { return; }

                const mode = (this.get('model.navMode') || this.get('model.filter') || '').split('/').pop();

                if (mode !== 'new' && mode !== 'unread') { return; }

                return I18n.t("topics.none.educate." + mode, {
                    userPrefsUrl: Discourse.getURL("/users/") + (Discourse.User.currentProp("username_lower")) + "/preferences"
                });
            }.property('allLoaded', 'model.topics.length')
        });

        // Directly copied/exposed from topic-tracking-state.js.es6
        function isNew(topic) {
          return topic.last_read_post_number === null &&
                ((topic.notification_level !== 0 && !topic.notification_level) ||
                topic.notification_level >= NotificationLevels.TRACKING);
        }

        function isUnread(topic) {
          return topic.last_read_post_number !== null &&
                 topic.last_read_post_number < topic.highest_post_number &&
                 topic.notification_level >= NotificationLevels.TRACKING;
        }
        // Modified to check project settings, so only relevant project notifications are shown
        TopicTrackingState.prototype.countNew = function(category_id) {
          return _.chain(this.states)
                  .where(isNew)
                  .where(topic =>
                          ((!this.project_guid && topic.project_is_public) || topic.project_guid == this.project_guid) &&
                          topic.archetype !== "private_message" &&
                          !topic.deleted && (
                          topic.category_id === category_id ||
                          topic.parent_category_id === category_id ||
                          !category_id)
                        )
                  .value()
                  .length;
        };
        TopicTrackingState.prototype.countUnread = function(category_id) {
          return _.chain(this.states)
                  .where(isUnread)
                  .where(topic =>
                        ((!this.project_guid && topic.project_is_public) || topic.project_guid == this.project_guid) &&
                        topic.archetype !== "private_message" &&
                        !topic.deleted && (
                        topic.category_id === category_id ||
                        topic.parent_category_id === category_id ||
                        !category_id)
                      )
                  .value()
                  .length;
        };

        var contributorSearch = function(term) {
            var topicModel = Discourse.__container__.lookup('controller:topic').model;
            var contributors = topicModel.contributors;
            contributors = contributors.filter(c => {
                return c.username.toLowerCase().startsWith(term.toLowerCase()) ||
                       c.name.toLowerCase().startsWith(term.toLowerCase());
            });

            var results = contributors;
            results.users = contributors.copy();
            results.groups = [];
            return results;
        };

        // Patch so that only contributors are listed for @mentions
        ComposerEditor.reopen({
            @on('didInsertElement')
            _composerEditorInit() {
                this._super();

                const template = this.container.lookup('template:user-selector-autocomplete.raw');
                const $input = this.$('.d-editor-input');
                $input.autocomplete('destroy');
                $input.autocomplete({
                    template,
                    dataSource: term => contributorSearch(term),
                    key: "@",
                    transformComplete: v => v.username || v.name
                });
            }
        });

        // keep track of the and allow access to the view_only id
        TopicController.reopen({
            queryParams: ['view_only'],
            view_only: null
        });

        // And have the parameter used in routing
        TopicRouter.reopen({
            queryParams: {
                view_only: { replace: true }
            }
        });

        TopicFromParamsRouter.reopen({
            setupController(controller, params, transition) {
                // we need to add the view_only id for it to end up in the xhr request
                if (transition.queryParams.view_only) {
                    params.view_only = transition.queryParams.view_only;
                }
                this._super(controller, params);
            }
        });
    }
};

# The discourse-osf-projects plugin
The Discourse plugins heavily modify how Discourse works without requiring us to actually fork Discourse itself. They do this through extensive reopening of both Ruby and Ember classes. Discourse naturally has the concepts of (user) groups, categories, topics, and posts. Although the schema for the DB is fixed, each of these entities can have “custom fields” by association with another DB table.

Read general documentation about writing Discourse plugins here: https://meta.discourse.org/t/beginners-guide-to-creating-discourse-plugins/30515

This plugin was designed to primarily encapsulate features that would be useful to anyone seeking to host a Discourse instance with many different sub-forums, so in general we try to avoid too many things that are OSF specific.

We make a group for each project named with the project’s GUID, and have the group consist of all the contributors to that project. Groups already have a visibility setting we use to indicate public/private projects.

Each topic has custom fields containing project_guid, parent_guids (which has the whole chain of “projects” (that is, projects or components) up to the top-most containing project) and a topic_guid as well. The topic_guid is the GUID of the entity that this topic is discussing, that is, the file GUID (topics are only created for files when the file is assigned a GUID), wiki GUID, or project/component GUID.

A topic is able to look-up the name of its containing project by looking up the topic whose topic_guid is also the project_guid. Since that special topic represents the project itself, its title is also the project's title. Since the project title is _only_ stored in that topic, it also provides a single place to update the project name.

##Hooks to Discourse Back-end
Modifications to the Discourse back-end occur in the plugin.rb file.

We modify the TopicController's show method so that if a topic is in a project, the project must either be public or the user a contributor to it in order to see it.
We modify TopicQuery's default_results method and Topic's secured method to filter topics in the same way.

We override the Topic slug method to return the topic_guid.

We use PostRevisor.track_topic_field to tell Discourse that we expect topic_guid and parent_guids to be fields that can be used when creating a topic. We also allow a topic to have the parent_guids field changed, which might have to happen if a component is moved or reorganized. I don't think the OSF currently does this, though.

On the before_create_topic event, we add the topic to the group associated with its project_guid.
On the topic_created event, we save the topic_guid and parent_guids in the topic's custom fields.

##New Back-end Endpoints
We make a new series of endpoints at /forum/:project_guid with essentially all the same functionality as the main Discourse page, but filtered by project_guid. The plugin also manages all privacy to ensure that only contributors may view and interact with private projects.

The endpoints exposed include:
/forum/:project_guid/:filter for each of the different Discourse filters including latest, unread, new, read, posted, and bookmarks.
/forum/:project_guid/top and /forum/:project_guid/top/:period for the periods yearly, quarterly, monthly, weekly, daily, and all.
/forum/:project_guid/c/:category and /forum/:project_guid/c/:category/l/:filter works the same (including with top in place of the filter), but constrained to results in the given category.
Finally, the code also allows nested categories that would be addressed at /forum/:project_guid/c/:parent_category/:category in the same manner. At the current moment, these are not being used.

The projects plug-in doesn't actually modify how Discourse deals with categories, but just tries to make sure they work with projects the way they do normally. Accordingly, if a new category is made, it will be created for all projects.

##Extra JSON sent to the Front-end
Because of all the additional information about projects stored behind the scenes, the plugin also causes the backend to send additional information to the front end.

The project page topic_list (anything beginning with /forum/:project_guid) reports the following: parent_guids, parent_names, project_is_public, can_create_topic, and contributors. Note that parent_guids[0] is by definition the project_guid. Also note that if a user has permission to see a certain project (e.g. a component) but not its parent project, parent_guids and parent_names will not acknowledge the existence of a parent project.

Whenever topics are listed, including on a topic_list page, each topic will report the following attributes: topic_guid, project_guid, project_name, project_is_public, excerpt, and excerpt_mentioned_users. The last entry, excerpt_mentioned_users, is used to make sure that the front end is able to replace username GUIDs with full names for users mentioned in the excerpt.

The topic page also reports: topic_guid, parent_guids, parent_names, project_is_public, and contributors (i.e. project contributors, who can be \@mentioned in the topic).

Whenever basic information about a user is serialized, we additionally send the name of that user in addition to the username. We specifically make sure the name is sent for a post's reply_to_user field.

Whenever data is sent on the message bus about an update, we also send the project_guid concerning the topic being reported on.

##New Ember Components
Following the standard Ember design, to create the new /forum/:project_guid endpoints, we have the projects-show route, projects.hbs and projects/show.hbs templates, and projects-show controller. These and many other parts of the Ember design draw heavily on code from the discourse-tagging plugin code, which is now integrated directly into Discourse.

There is also a blank projects/index.hbs file needed because Ember insists on an index page but we don't need one, and a loading.hbs file used to show a loading spinner during transitions. This is done by Ember automatically without our needing to explicitly reference that file.

The osf-projects-route-map file defines all the routes/endpoints that our plugin adds. The project-route-builder initializer takes all of these different routes and points them all to the projects-show route, just with different parameters.

The projects.hbs template only sets up some baseline html into which one of the index.hbs, loading.hbs, or show.hbs files will be inserted.

The projects/show.hbs template defines the pieces that make up the page: the title with the name of the project, the "bread-crumbs" component for letting the user select a category to filter by, the navigation-bar component to select other filters, and finally an outlet into which the entire discovery/topics.hbs template will be inserted, which is what Discourse uses for showing lists of topics on the standard pages.

The projects.show route makes sure that all the different components of the page have the right information. It creates the model objects and otherwise gives settings to the different controllers. Although we have a projects.show controller, the majority of the standard work is offloaded to the standard discovery.topics controller, template, and other related things. The route makes sure that a composer for creating a new topic is aware of the project the new topic must be put into.

The projects.show controller only really concerns itself with setting up the bread-crumbs and navigation-bar settings (which categories you can choose from; latest, unread, new, top topics, etc). It doesn't need to do very much because most of the data is already present in the model.

##Ember hooks
In the extend-for-projects initializer, we extend the Ember components necessary to make everything behave properly around projects.

The biggest job is to fix the urls generated by different components so that they only reference things in the current project. Because we use the standard discovery.topics controller and template and they are not aware of projects, they will generate links that refer to general site-wide pages. We make category links, and latest links, and all categories links all point to relevant places within the current project instead of without.

In order for the page to keep these links consistent, we need to have a hook on each of the different places that might indicate the recreation/rerendering of those links. We put hooks on page change, dom change in the topic view, update from JSON in the topic model, after rendering of the topic/post stream widget (or any other widget), expanding of the category drop-down in the bread-crumbs component, and toggling of the bulk selection option. In nearly each case, we add the fixing of the urls to Ember run loop to occur only once after the rendering finishes. This makes the url fixing function run at the right time and not more than necessary.

We also modify the navigation item's 'active' method because with our modified routes now including /forum/:project_guid, the original function performed a wrong comparison.

Similarly, we have to modify the discovery.topics controller in three functions to make it work with our /forum/:project_guid routes.

We modify TopicTrackingState's notify method to not report on messages from Discourse about topics that are not in the current project. If we didn't do this, Discourse would tell us that there is a 'new' or 'unread' topic we should read when a relevant topic in another project is made or modified. We could go navigate to the 'new' topic tab, but wouldn't find any new topic there, because it is actually in a different project.

Finally, we modify the composer editor's \@mention autocomplete functionality so that it only helps you make \@mentions for individuals who are contributors to the project.

##Discourse Connectors
Connectors are a concept Discourse uses in order to insert handlebar (hbs) template materials into the built-in templates at specific places.

The show-project.hbs file is inserted into the 'composer-open' plugin outlet. It adds a link to the composer window to show what project a topic being created or edited is in.

The parent-project-label.raw.hbs file is added to the topic-list-tags plugin outlet. Because this plugin outlet is within the topic list, it was optimized to work with virtual-dom and not be processed by Ember. So the template is actually a little more constrained and must be marked as .raw.hbs. This connector simply adds a label/link to each topic in a topic list with the project it is in.

The show-project.hbs file inserted into the topic-title plugin outlet displays the entire chain of containing and parent projects that the topic is contained in.

##CSS
Finally, there is a osf-projects.scss file with a minimum number of styles to support the project/forum page.

##Further Work/Bugs to Fix
